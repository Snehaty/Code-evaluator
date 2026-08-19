// apps/web/lib/requirements/service.ts
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  requirementVersions,
  requirements,
  type Db,
} from "@zkcvp/db";
import type { RequirementStatus } from "@zkcvp/contracts";
import { isProjectMember } from "../auth/authorization";
import type { Session } from "../auth/types";
import { forbidden, notFound } from "../api/errors";
import { assertStakeholderMember } from "../projects/service";

export type RequirementView = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  /** ALWAYS from the current version via a join. Never stored on requirements. */
  status: RequirementStatus;
  versionNumber: number;
  currentVersionId: string;
  archivedAt: Date | null;
  createdAt: Date;
};

export type VersionView = {
  id: string;
  versionNumber: number;
  title: string;
  description: string;
  status: RequirementStatus;
  createdAt: Date;
};

/** The single projection of "requirement joined to its current version". */
const requirementView = {
  id: requirements.id,
  projectId: requirements.projectId,
  title: requirementVersions.title,
  description: requirementVersions.description,
  status: requirementVersions.status,
  versionNumber: requirementVersions.versionNumber,
  currentVersionId: requirementVersions.id,
  archivedAt: requirements.archivedAt,
  createdAt: requirements.createdAt,
};

/**
 * One transaction, in three steps, because `current_version_id` and
 * `requirement_id` are a circular FK pair: insert the requirement with a null
 * pointer, insert version 1, then point the requirement at it. The column is
 * nullable ONLY for the width of this transaction.
 */
export async function createRequirement(
  db: Db,
  session: Session,
  projectId: string,
  input: { title: string; description: string },
): Promise<RequirementView> {
  const caller = await assertStakeholderMember(db, session, projectId);

  return db.transaction(async (tx) => {
    const [requirement] = await tx
      .insert(requirements)
      .values({ projectId, createdBy: caller.stakeholderId })
      .returning();

    const [version] = await tx
      .insert(requirementVersions)
      .values({
        requirementId: requirement.id,
        versionNumber: 1,
        title: input.title,
        description: input.description,
        /* Written explicitly rather than left to the column default, so plan 01
         * invariant 4 is visible at the line that could break it. */
        status: "new",
        createdBy: caller.stakeholderId,
      })
      .returning();

    await tx
      .update(requirements)
      .set({ currentVersionId: version.id })
      .where(eq(requirements.id, requirement.id));

    return {
      id: requirement.id,
      projectId: requirement.projectId,
      title: version.title,
      description: version.description,
      status: version.status,
      versionNumber: version.versionNumber,
      currentVersionId: version.id,
      archivedAt: requirement.archivedAt,
      createdAt: requirement.createdAt,
    };
  });
}

export async function listRequirements(
  db: Db,
  session: Session,
  projectId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<RequirementView[]> {
  if (!(await isProjectMember(db, session, projectId))) throw forbidden();

  return db
    .select(requirementView)
    .from(requirements)
    .innerJoin(
      requirementVersions,
      eq(requirements.currentVersionId, requirementVersions.id),
    )
    .where(
      opts.includeArchived
        ? eq(requirements.projectId, projectId)
        : and(
            eq(requirements.projectId, projectId),
            isNull(requirements.archivedAt),
          ),
    )
    .orderBy(asc(requirements.createdAt));
}

/** Loads a requirement without an authorization check. Internal use only. */
export async function loadRequirement(
  db: Db,
  requirementId: string,
): Promise<RequirementView> {
  const [row] = await db
    .select(requirementView)
    .from(requirements)
    .innerJoin(
      requirementVersions,
      eq(requirements.currentVersionId, requirementVersions.id),
    )
    .where(eq(requirements.id, requirementId));

  if (!row) throw notFound("No such requirement");
  return row;
}

export async function getRequirement(
  db: Db,
  session: Session,
  requirementId: string,
): Promise<{ requirement: RequirementView; versionHistory: VersionView[] }> {
  const requirement = await loadRequirement(db, requirementId);

  if (!(await isProjectMember(db, session, requirement.projectId))) {
    throw forbidden();
  }

  const versionHistory = await db
    .select({
      id: requirementVersions.id,
      versionNumber: requirementVersions.versionNumber,
      title: requirementVersions.title,
      description: requirementVersions.description,
      status: requirementVersions.status,
      createdAt: requirementVersions.createdAt,
    })
    .from(requirementVersions)
    .where(eq(requirementVersions.requirementId, requirementId))
    .orderBy(asc(requirementVersions.versionNumber));

  return { requirement, versionHistory };
}
