// apps/web/lib/claims/service.ts
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  claimRepos,
  claimRequirementVersions,
  claims,
  evaluations,
  projectRepos,
  requirementVersions,
  requirements,
  verdicts,
  type Db,
} from "@zkcvp/db";
import type { EvidenceBundle, Report, Verdict } from "@zkcvp/contracts";
import type { RequirementStatus } from "@zkcvp/contracts";
import { conflict, forbidden, notFound } from "../api/errors";
import { isProjectMember } from "../auth/authorization";
import type { Session } from "../auth/types";
import { assertDeveloperMember } from "../repos/service";

export type NewClaim = {
  claimId: string;
  repoCommits: { repo: string; commitSha: string }[];
  requirements: { requirementVersionId: string; title: string; description: string }[];
};

/**
 * A verdict's effect on the requirement version it judged.
 *
 * `eval_failed` means the Evaluator returned NOT SATISFIED. It is a legitimate
 * result, and the enum name is the only thing misleading about it — which is
 * why the string never reaches a screen.
 */
const STATUS_BY_VERDICT: Record<Verdict, RequirementStatus> = {
  satisfied: "verified",
  not_satisfied: "eval_failed",
};

/** Sorted-key JSON, so the same bundle always hashes the same. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
  return `{${entries.join(",")}}`;
}

export function evidenceHash(evidence: EvidenceBundle): string {
  return createHash("sha256").update(canonical(evidence)).digest("hex");
}

/**
 * Writes the claim and returns exactly what the Evaluator needs.
 *
 * Everything fallible happens here, BEFORE the response starts streaming, so
 * each failure still gets a true HTTP status code.
 */
export async function createClaim(
  db: Db,
  session: Session,
  projectId: string,
  input: {
    requirementVersionIds: string[];
    repos: { projectRepoId: string; commitSha: string }[];
  },
): Promise<NewClaim> {
  const dev = await assertDeveloperMember(db, session, projectId);

  if (input.requirementVersionIds.length === 0) {
    throw conflict("A claim must name at least one requirement");
  }
  if (input.repos.length === 0) {
    throw conflict("A claim must name at least one commit");
  }

  const versions = await db
    .select({
      id: requirementVersions.id,
      title: requirementVersions.title,
      description: requirementVersions.description,
      requirementId: requirementVersions.requirementId,
      currentVersionId: requirements.currentVersionId,
      projectId: requirements.projectId,
      archivedAt: requirements.archivedAt,
    })
    .from(requirementVersions)
    .innerJoin(requirements, eq(requirements.id, requirementVersions.requirementId))
    .where(inArray(requirementVersions.id, input.requirementVersionIds));

  if (versions.length !== input.requirementVersionIds.length) {
    throw notFound("No such requirement version");
  }
  for (const v of versions) {
    if (v.projectId !== projectId) throw notFound("No such requirement version");
    if (v.archivedAt !== null) throw conflict("That requirement is archived");
    /* Pinned optimistically. Evaluating a version the developer never read
     * would attribute to them a claim they did not make; evaluating the
     * superseded one would judge text that no longer exists. */
    if (v.currentVersionId !== v.id) {
      throw conflict(
        "A requirement changed while this claim was being composed. Reload and try again.",
      );
    }
  }

  const repoIds = input.repos.map((r) => r.projectRepoId);
  if (repoIds.length !== new Set(repoIds).size) {
    throw conflict("A claim may name at most one commit per repo");
  }

  const attached = await db
    .select()
    .from(projectRepos)
    .where(and(eq(projectRepos.projectId, projectId), inArray(projectRepos.id, repoIds)));

  if (attached.length !== new Set(repoIds).size) {
    throw notFound("No such attached repo");
  }

  const nameById = new Map(attached.map((r) => [r.id, r.fullName]));

  const claimId = await db.transaction(async (tx) => {
    const [claim] = await tx
      .insert(claims)
      .values({ projectId, submittedBy: dev.developerId })
      .returning();

    await tx.insert(claimRepos).values(
      input.repos.map((r) => ({
        claimId: claim.id,
        projectRepoId: r.projectRepoId,
        commitSha: r.commitSha,
      })),
    );

    await tx.insert(claimRequirementVersions).values(
      input.requirementVersionIds.map((requirementVersionId) => ({
        claimId: claim.id,
        requirementVersionId,
      })),
    );

    return claim.id;
  });

  return {
    claimId,
    repoCommits: input.repos.map((r) => ({
      repo: nameById.get(r.projectRepoId)!,
      commitSha: r.commitSha,
    })),
    requirements: versions.map((v) => ({
      requirementVersionId: v.id,
      title: v.title,
      description: v.description,
    })),
  };
}

/**
 * The second transaction. Called ONLY when both artifacts exist.
 *
 * A failed run never reaches this function, which is what leaves every
 * requirement version holding exactly the status it had. There is no draft
 * state to park a partial report in, so a partial report is strictly worse
 * than none.
 */
export async function recordEvaluation(
  db: Db,
  claimId: string,
  artifacts: { evidence: EvidenceBundle; report: Report },
): Promise<void> {
  const { evidence, report } = artifacts;

  await db.transaction(async (tx) => {
    await tx.insert(evaluations).values({
      id: report.evaluationId,
      claimId,
      modelId: report.modelId,
      promptTemplateVersion: report.promptTemplateVersion,
      createdAt: new Date(report.createdAt),
      evidence,
      evidenceHash: evidenceHash(evidence),
    });

    await tx.insert(verdicts).values(
      report.perRequirement.map((r) => ({
        evaluationId: report.evaluationId,
        requirementVersionId: r.requirementVersionId,
        verdict: r.verdict,
        rationale: r.rationale,
      })),
    );

    for (const r of report.perRequirement) {
      await tx
        .update(requirementVersions)
        .set({ status: STATUS_BY_VERDICT[r.verdict] })
        .where(eq(requirementVersions.id, r.requirementVersionId));
    }
  });
}

export type ClaimDetail = {
  id: string;
  projectId: string;
  submittedAt: Date;
  commits: { fullName: string; commitSha: string }[];
  /** Absent when the run was interrupted — an abandoned submission, not a status. */
  evaluation: {
    id: string;
    modelId: string;
    createdAt: Date;
    evidenceHash: string;
    results: { requirementVersionId: string; title: string; verdict: Verdict; rationale: string }[];
  } | null;
};

/**
 * Readable by any project member, stakeholders included: the report is
 * unconditionally visible the moment it exists. The evidence bundle is not
 * selected here at all, so it cannot leak through this path by accident.
 */
export async function getClaim(
  db: Db,
  session: Session,
  claimId: string,
): Promise<ClaimDetail> {
  const [claim] = await db.select().from(claims).where(eq(claims.id, claimId));
  if (!claim) throw notFound("No such claim");
  if (!(await isProjectMember(db, session, claim.projectId))) throw forbidden();

  const commits = await db
    .select({ fullName: projectRepos.fullName, commitSha: claimRepos.commitSha })
    .from(claimRepos)
    .innerJoin(projectRepos, eq(projectRepos.id, claimRepos.projectRepoId))
    .where(eq(claimRepos.claimId, claimId));

  const [evaluation] = await db
    .select({
      id: evaluations.id,
      modelId: evaluations.modelId,
      createdAt: evaluations.createdAt,
      evidenceHash: evaluations.evidenceHash,
    })
    .from(evaluations)
    .where(eq(evaluations.claimId, claimId));

  if (!evaluation) {
    return {
      id: claim.id,
      projectId: claim.projectId,
      submittedAt: claim.submittedAt,
      commits,
      evaluation: null,
    };
  }

  const results = await db
    .select({
      requirementVersionId: verdicts.requirementVersionId,
      title: requirementVersions.title,
      verdict: verdicts.verdict,
      rationale: verdicts.rationale,
    })
    .from(verdicts)
    .innerJoin(
      requirementVersions,
      eq(requirementVersions.id, verdicts.requirementVersionId),
    )
    .where(eq(verdicts.evaluationId, evaluation.id));

  return {
    id: claim.id,
    projectId: claim.projectId,
    submittedAt: claim.submittedAt,
    commits,
    evaluation: { ...evaluation, results },
  };
}
