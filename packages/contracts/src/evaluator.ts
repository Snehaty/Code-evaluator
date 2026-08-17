import type { Verdict } from "./domain";
import type { GitHubReadTool, RepoCommit } from "./github";

export type EvaluatorInput = {
  claim: {
    /**
     * Identifies the developer's submission that triggered this evaluation.
     * This is a CALLER concept (it comes from the future claim-submission
     * flow, not from the Evaluator itself), so it arrives via the input
     * rather than being minted inside `evaluate()`. It is echoed back
     * verbatim into both `EvidenceBundle.claimId` and `Report.claimId`.
     */
    claimId: string;
    /** One or more, shared across every requirement in this batch. */
    repoCommits: RepoCommit[];
  };
  /** One or more, evaluated together against the same claim. */
  requirements: {
    requirementVersionId: string;
    title: string;
    description: string;
  }[];
  github: GitHubReadTool;
};

export type ToolCall = {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  at: string;
};

/**
 * The raw tool-call transcript, containing verbatim source from a private repo.
 *
 * NOT shown to the stakeholder in this phase — stored only. This is what gets
 * hashed for the Transparency Log's `evidence_hash`, which is what makes
 * integrity checkable WITHOUT disclosing contents. Withheld is not unverifiable;
 * the two are separate operations and the first never requires the second.
 */
export type EvidenceBundle = {
  /**
   * Identifies one *execution* of `evaluate()`. Unlike `claimId`, this is a
   * CALLEE concept — a real implementation mints it itself (e.g.
   * `crypto.randomUUID()` at the start of `evaluate()`) and uses the same
   * value here and in the returned `Report`, rather than receiving it via
   * `EvaluatorInput`.
   */
  evaluationId: string;
  claimId: string;
  toolCallLog: ToolCall[];
};

/**
 * Human language only, one entry per requirement in the batch.
 *
 * Unconditionally visible to the stakeholder the moment evaluation completes —
 * no developer consent step, no release flag, no gating of any kind.
 */
export type Report = {
  evaluationId: string;
  claimId: string;
  modelId: string;
  promptTemplateVersion: string;
  /** ISO 8601. Dates are absolute throughout this product, never relative. */
  createdAt: string;
  perRequirement: {
    requirementVersionId: string;
    verdict: Verdict;
    /**
     * Prose. Must never embed verbatim source code — a file path or a line
     * range is fine, pasted code is not. This is a GENERATION-TIME constraint
     * on the agent's output step, not a display-layer filter: filtering code
     * out of already-generated text is unreliable.
     */
    rationale: string;
  }[];
};

/**
 * The Evaluator, black-boxed on purpose.
 *
 * Returns two STRUCTURALLY SEPARATE artifacts. They are never merged into one
 * object: one is withheld and one is unconditionally visible, and a shape that
 * blurs that invites a surface that blurs it too.
 *
 * A plain async function by design. The route handler that calls it is a thin
 * adapter, so moving between a serverless host and a long-lived Node host
 * changes where this is invoked from, not what it is.
 */
export interface Evaluator {
  evaluate(input: EvaluatorInput): Promise<{
    evidence: EvidenceBundle;
    report: Report;
  }>;
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}
