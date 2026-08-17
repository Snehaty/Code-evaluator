export type RepoCommit = {
  /** "owner/name". */
  repo: string;
  /** Full 40-character SHA. The Evaluator reads this exact commit, never HEAD. */
  commitSha: string;
};

export type TreeEntry = {
  path: string;
  type: "file" | "dir";
  size?: number;
};

/**
 * File and diff access scoped to specific commit SHAs.
 *
 * Authenticated as the requesting developer's own live GitHub OAuth token —
 * never a service-level credential, and there is no GitHub App or installation
 * anywhere in this design. The token is injected by the caller and is never
 * stored, logged, or serialised into either output artifact.
 *
 * This is also why evaluation runs synchronously inside the request that submits
 * a claim: there is no persisted token a background process could use once the
 * developer's session ends.
 */
export interface GitHubReadTool {
  readFile(repo: string, commitSha: string, path: string): Promise<string>;
  listTree(repo: string, commitSha: string, path?: string): Promise<TreeEntry[]>;
  diff(repo: string, baseSha: string, headSha: string): Promise<string>;
}
