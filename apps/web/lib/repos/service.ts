// apps/web/lib/repos/service.ts
import { and, eq } from "drizzle-orm";
import { projectRepos, type Db } from "@zkcvp/db";
import {
  createGitHubClient,
  listUserRepos,
  type GithubRepo,
} from "@zkcvp/github";
import { isDeveloperMember, isProjectMember } from "../auth/authorization";
import type { DeveloperSession, Session } from "../auth/types";
import { conflict, forbidden, isUniqueViolation, notFound } from "../api/errors";

/**
 * Removal is an undo, not a detach.
 *
 * Past this window an attachment is permanent for the life of the project.
 * That is what makes a claim unable to reference a repo removed from under it,
 * which is why claims may hold a plain foreign key to an attachment row.
 */
export const UNDO_WINDOW_MS = 60_000;

export type AttachedRepo = {
  id: string;
  githubRepoId: string;
  fullName: string;
  addedAt: Date;
  /** Absolute instant the undo expires. The UI never computes this itself. */
  undoableUntil: Date;
};

/** Injected so tests never reach the network. Production passes the real call. */
export type RepoLister = { list: (client: ReturnType<typeof createGitHubClient>) => Promise<GithubRepo[]> };

export const liveRepoLister: RepoLister = { list: listUserRepos };

const present = (row: typeof projectRepos.$inferSelect): AttachedRepo => ({
  id: row.id,
  githubRepoId: row.githubRepoId,
  fullName: row.fullName,
  addedAt: row.addedAt,
  undoableUntil: new Date(row.addedAt.getTime() + UNDO_WINDOW_MS),
});

/**
 * Every repo action but reading requires a developer, because every one of them
 * spends the acting developer's own GitHub token. A stakeholder has no GitHub
 * identity at all, so this is a statement about capability, not about trust.
 */
export async function assertDeveloperMember(
  db: Db,
  session: Session,
  projectId: string,
): Promise<DeveloperSession> {
  if (session.kind !== "developer") {
    throw forbidden("Only a developer may perform this action");
  }
  if (!(await isDeveloperMember(db, session.developerId, projectId))) {
    throw forbidden();
  }
  return session;
}

/** Readable by any project member: it touches the attachment table only. */
export async function listAttachedRepos(
  db: Db,
  session: Session,
  projectId: string,
): Promise<AttachedRepo[]> {
  if (!(await isProjectMember(db, session, projectId))) throw forbidden();

  const rows = await db
    .select()
    .from(projectRepos)
    .where(eq(projectRepos.projectId, projectId))
    .orderBy(projectRepos.addedAt);

  return rows.map(present);
}

export async function listCandidateRepos(
  db: Db,
  session: Session,
  projectId: string,
  gh: RepoLister = liveRepoLister,
): Promise<GithubRepo[]> {
  const dev = await assertDeveloperMember(db, session, projectId);

  const attached = await db
    .select({ githubRepoId: projectRepos.githubRepoId })
    .from(projectRepos)
    .where(eq(projectRepos.projectId, projectId));

  const taken = new Set(attached.map((r) => r.githubRepoId));
  const all = await gh.list(createGitHubClient(dev.githubAccessToken));
  return all.filter((r) => !taken.has(r.githubRepoId));
}

export async function attachRepo(
  db: Db,
  session: Session,
  projectId: string,
  input: { githubRepoId: string; fullName: string },
): Promise<AttachedRepo> {
  const dev = await assertDeveloperMember(db, session, projectId);

  /* Insert and let the unique constraint arbitrate, rather than checking then
   * inserting — the same approach the developer-invite endpoint takes, and for
   * the same reason: a check-then-insert has a race the constraint does not. */
  try {
    const [row] = await db
      .insert(projectRepos)
      .values({
        projectId,
        githubRepoId: input.githubRepoId,
        fullName: input.fullName,
        addedBy: dev.developerId,
      })
      .returning();
    return present(row);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw conflict("That repo is already attached to this project");
    }
    throw e;
  }
}

export async function detachRepo(
  db: Db,
  session: Session,
  projectId: string,
  repoId: string,
): Promise<void> {
  await assertDeveloperMember(db, session, projectId);

  const [row] = await db
    .select()
    .from(projectRepos)
    .where(and(eq(projectRepos.id, repoId), eq(projectRepos.projectId, projectId)));

  /* Scoped to the project in the query, so a repo attached to a project the
   * caller cannot see is a 404 and not a 403 — the response must not confirm
   * that the id exists somewhere else. */
  if (!row) throw notFound("No such attached repo");

  if (Date.now() - row.addedAt.getTime() > UNDO_WINDOW_MS) {
    throw conflict(
      "The undo window has passed. An attached repo is permanent for the life of the project.",
    );
  }

  await db.delete(projectRepos).where(eq(projectRepos.id, repoId));
}
