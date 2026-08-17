// packages/github/src/index.ts

/**
 * The whole M3 surface: a client constructed from a developer's session
 * access token. No fetch calls, no API methods — those get added as a
 * caller actually needs them (see docs/architecture.md, M3/M4).
 */
export interface GitHubClient {
  readonly accessToken: string;
}

export function createGitHubClient(accessToken: string): GitHubClient {
  if (!accessToken) {
    throw new Error("createGitHubClient requires a non-empty accessToken");
  }
  return { accessToken };
}

export type GithubUser = {
  /** GitHub's NUMERIC id as text. The only identity key. Never the username. */
  githubUserId: string;
  /** Cache only, for display. */
  githubUsername: string;
  displayName: string;
  avatarUrl: string | null;
};

export class GithubUserNotFound extends Error {
  constructor(username: string) {
    super(`No GitHub user named ${username}`);
    this.name = "GithubUserNotFound";
  }
}

export class GithubUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubUnavailable";
  }
}

/**
 * Resolves a username to a stable numeric id at invite time.
 *
 * UNAUTHENTICATED on purpose: the caller is a stakeholder, who has no GitHub
 * token, and plan 01 rules out any service-level credential. GitHub caps
 * unauthenticated requests at 60/hour per IP, shared by every stakeholder on the
 * deployment — so exhaustion is a real operational condition, not an edge case,
 * and it is reported as unavailability rather than as a missing user.
 */
export async function resolveGithubUser(username: string): Promise<GithubUser> {
  let res: Response;
  try {
    res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(username)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        /* A hung connection to GitHub would otherwise hold a stakeholder's
         * request open indefinitely. The catch below maps this — like every
         * other fetch failure — to GithubUnavailable, never to
         * GithubUserNotFound: a timeout says nothing about whether the user
         * exists. */
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch (e) {
    throw new GithubUnavailable(
      `Could not reach GitHub: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  if (res.status === 404) throw new GithubUserNotFound(username);

  if (
    (res.status === 403 || res.status === 429) &&
    res.headers.get("x-ratelimit-remaining") === "0"
  ) {
    throw new GithubUnavailable(
      "GitHub's unauthenticated rate limit is exhausted. Try again shortly.",
    );
  }

  if (!res.ok) throw new GithubUnavailable(`GitHub returned ${res.status}`);

  const body = (await res.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
  };

  return {
    githubUserId: String(body.id),
    githubUsername: body.login,
    displayName: body.name ?? body.login,
    avatarUrl: body.avatar_url ?? null,
  };
}
