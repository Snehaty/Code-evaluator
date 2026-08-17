import type { GitHubReadTool, TreeEntry } from "@zkcvp/contracts";

/**
 * Concrete GitHubReadTool implementation.
 *
 * Calls GitHub REST API using the developer's OAuth token.
 * The token is sealed inside — the LLM never sees it.
 * Native fetch, no SDK (architecture rule).
 */
export class GitHubReadToolImpl implements GitHubReadTool {
  private readonly token: string;
  private readonly baseUrl = "https://api.github.com";

  constructor(accessToken: string) {
    if (!accessToken) {
      throw new Error("GitHubReadToolImpl requires a non-empty accessToken");
    }
    this.token = accessToken;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "zkcvp-evaluator",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  /**
   * Read a single file's content at an exact commit SHA.
   * GitHub returns Base64 — we decode to UTF-8.
   *
   * API: GET /repos/{owner}/{repo}/contents/{path}?ref={sha}
   */
  async readFile(
    repo: string,
    commitSha: string,
    path: string,
  ): Promise<string> {
    const url = `${this.baseUrl}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${commitSha}`;
    const resp = await fetch(url, { headers: this.headers() });

    if (resp.status === 404) {
      throw new GitHubApiError(
        `File not found: ${path} at ${commitSha.substring(0, 8)}`,
        404,
      );
    }
    if (!resp.ok) {
      throw new GitHubApiError(
        `GitHub API error reading ${path}: HTTP ${resp.status}`,
        resp.status,
      );
    }

    const data = (await resp.json()) as { content?: string; encoding?: string };

    if (data.encoding !== "base64" || !data.content) {
      throw new GitHubApiError(
        `Unexpected encoding for ${path}: ${data.encoding ?? "none"}`,
        422,
      );
    }

    // GitHub returns Base64 with newlines — strip them before decoding
    const clean = data.content.replace(/\n/g, "");
    return Buffer.from(clean, "base64").toString("utf-8");
  }

  /**
   * List the file tree at an exact commit SHA.
   * Optionally filter to a subdirectory.
   *
   * API: GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1
   */
  async listTree(
    repo: string,
    commitSha: string,
    path?: string,
  ): Promise<TreeEntry[]> {
    // First resolve the commit SHA to a tree SHA
    const commitUrl = `${this.baseUrl}/repos/${repo}/commits/${commitSha}`;
    const commitResp = await fetch(commitUrl, { headers: this.headers() });

    if (!commitResp.ok) {
      throw new GitHubApiError(
        `Failed to resolve commit ${commitSha.substring(0, 8)}: HTTP ${commitResp.status}`,
        commitResp.status,
      );
    }

    const commitData = (await commitResp.json()) as {
      commit: { tree: { sha: string } };
    };
    const treeSha = commitData.commit.tree.sha;

    const treeUrl = `${this.baseUrl}/repos/${repo}/git/trees/${treeSha}?recursive=1`;
    const treeResp = await fetch(treeUrl, { headers: this.headers() });

    if (!treeResp.ok) {
      throw new GitHubApiError(
        `Failed to list tree: HTTP ${treeResp.status}`,
        treeResp.status,
      );
    }

    const treeData = (await treeResp.json()) as {
      tree: { path: string; type: string; size?: number }[];
    };

    let entries = treeData.tree.map(
      (entry): TreeEntry => ({
        path: entry.path,
        type: entry.type === "blob" ? "file" : "dir",
        size: entry.size,
      }),
    );

    // Filter to subdirectory if path specified
    if (path) {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      entries = entries.filter((e) => e.path.startsWith(prefix));
    }

    return entries;
  }

  /**
   * Get the diff between two commits.
   *
   * API: GET /repos/{owner}/{repo}/compare/{base}...{head}
   */
  async diff(
    repo: string,
    baseSha: string,
    headSha: string,
  ): Promise<string> {
    const url = `${this.baseUrl}/repos/${repo}/compare/${baseSha}...${headSha}`;
    const resp = await fetch(url, { headers: this.headers() });

    if (!resp.ok) {
      throw new GitHubApiError(
        `Failed to compare ${baseSha.substring(0, 8)}...${headSha.substring(0, 8)}: HTTP ${resp.status}`,
        resp.status,
      );
    }

    const data = (await resp.json()) as {
      files?: { filename: string; status: string; patch?: string }[];
    };

    if (!data.files) return "";

    return data.files
      .map((f) => `--- ${f.filename} (${f.status})\n${f.patch ?? ""}`)
      .join("\n\n");
  }
}

/**
 * Factory function — matches the pattern used by packages/github.
 */
export function createGitHubReadTool(accessToken: string): GitHubReadTool {
  return new GitHubReadToolImpl(accessToken);
}

/**
 * Typed error for GitHub API failures.
 */
export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}
