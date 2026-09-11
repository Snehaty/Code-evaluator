// apps/web/tests/repos/live.test.ts
import { describe, expect, it } from "vitest";
import { withTestSchema } from "@zkcvp/db/testing";
import {
  developers,
  projectDevelopers,
  projectRepos,
  projects,
  stakeholders,
  type Db,
} from "@zkcvp/db";
import { ServiceError } from "../../lib/api/errors";
import { getAttachedRepo } from "../../lib/repos/service";

async function fixture(db: Db) {
  const [s] = await db
    .insert(stakeholders)
    .values({ email: "s@example.com", displayName: "S" })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({ name: "P", createdBy: s.id })
    .returning();
  const [dev] = await db
    .insert(developers)
    .values({ githubUserId: "77", githubUsername: "mira", displayName: "Mira" })
    .returning();
  await db
    .insert(projectDevelopers)
    .values({ projectId: project.id, developerId: dev.id, addedBy: s.id });
  const [repo] = await db
    .insert(projectRepos)
    .values({
      projectId: project.id,
      githubRepoId: "1296269",
      fullName: "octocat/Hello-World",
      addedBy: dev.id,
    })
    .returning();

  return {
    project,
    repo,
    devSession: {
      kind: "developer" as const,
      developerId: dev.id,
      githubAccessToken: "gho_token",
    },
  };
}

describe("getAttachedRepo", () => {
  it("resolves a repo id to the stored full name", async () => {
    await withTestSchema(async (db) => {
      const { project, repo, devSession } = await fixture(db);

      const found = await getAttachedRepo(db, devSession, project.id, repo.id);

      expect(found.fullName).toBe("octocat/Hello-World");
    });
  });

  it("404s for a repo id that is not attached to this project", async () => {
    await withTestSchema(async (db) => {
      const { project, devSession } = await fixture(db);

      const err = await getAttachedRepo(
        db,
        devSession,
        project.id,
        "00000000-0000-0000-0000-000000000000",
      ).catch((e) => e);

      expect((err as ServiceError).status).toBe(404);
    });
  });
});
