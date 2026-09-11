// apps/web/app/api/projects/[projectId]/repos/[repoId]/commits/route.ts
import { createGitHubClient, GithubUnavailable, listCommits } from "@zkcvp/github";
import { handle } from "../../../../../../../lib/api/respond";
import { getDb } from "../../../../../../../lib/db";
import { requireSession } from "../../../../../../../lib/auth/session";
import { getAttachedRepo } from "../../../../../../../lib/repos/service";
import { githubUnavailable, invalidBody } from "../../../../../../../lib/api/errors";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; repoId: string }> },
) {
  return handle(async () => {
    const { projectId, repoId } = await params;
    const session = await requireSession();
    const repo = await getAttachedRepo(getDb(), session, projectId, repoId);
    if (session.kind !== "developer") throw githubUnavailable();

    const ref = new URL(req.url).searchParams.get("ref");
    if (!ref) throw invalidBody({ ref: "Required" });

    try {
      const commits = await listCommits(
        createGitHubClient(session.githubAccessToken),
        repo.fullName,
        ref,
      );
      return Response.json({ commits });
    } catch (e) {
      if (e instanceof GithubUnavailable) throw githubUnavailable(e.message);
      throw e;
    }
  });
}
