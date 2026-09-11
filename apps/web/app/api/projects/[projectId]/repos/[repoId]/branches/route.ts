// apps/web/app/api/projects/[projectId]/repos/[repoId]/branches/route.ts
import { createGitHubClient, GithubUnavailable, listBranches } from "@zkcvp/github";
import { handle } from "../../../../../../../lib/api/respond";
import { getDb } from "../../../../../../../lib/db";
import { requireSession } from "../../../../../../../lib/auth/session";
import { getAttachedRepo } from "../../../../../../../lib/repos/service";
import { githubUnavailable } from "../../../../../../../lib/api/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; repoId: string }> },
) {
  return handle(async () => {
    const { projectId, repoId } = await params;
    const session = await requireSession();
    const repo = await getAttachedRepo(getDb(), session, projectId, repoId);

    /* The session must be a developer's by now — getAttachedRepo asserts it —
     * but narrow explicitly rather than casting, so a future change to that
     * assertion cannot silently reach for a token that is not there. */
    if (session.kind !== "developer") throw githubUnavailable();

    try {
      const branches = await listBranches(
        createGitHubClient(session.githubAccessToken),
        repo.fullName,
      );
      return Response.json({ branches, defaultBranchFirst: true });
    } catch (e) {
      if (e instanceof GithubUnavailable) throw githubUnavailable(e.message);
      throw e;
    }
  });
}
