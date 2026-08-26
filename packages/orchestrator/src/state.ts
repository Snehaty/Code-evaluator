import type { ToolCall, GitHubReadTool } from "@zkcvp/contracts";
import type { Verdict } from "@zkcvp/contracts";

/**
 * State object that flows through every LangGraph node.
 *
 * Initialized once at graph entry, progressively enriched by each node.
 * Only the FORMAT node reads the full state to produce the two output artifacts.
 */
export type EvaluatorState = {
  // ── Input (set once at start, never mutated) ──
  claimId: string;
  evaluationId: string;
  repoCommits: { repo: string; commitSha: string }[];
  requirements: {
    requirementVersionId: string;
    title: string;
    description: string;
  }[];
  github: GitHubReadTool;
  modelId?: string;

  // ── Built by PLAN node ──
  plan: string[];              // file paths the LLM decided to read

  // ── Built by GATHER node ──
  toolCallLog: ToolCall[];     // every GitHub API call, becomes EvidenceBundle
  gatheredFiles: Record<string, string>;  // path → content cache

  // ── Built by ANALYZE node ──
  verdicts: {
    requirementVersionId: string;
    verdict: Verdict;
    rationale: string;
  }[];
  needsMoreEvidence: boolean;
  additionalFilesNeeded: string[];  // paths the LLM wants to read next

  // ── Control ──
  iterationCount: number;
  error: string | null;
};

/**
 * Initial state factory — creates a clean state from EvaluatorInput.
 */
export function createInitialState(
  claimId: string,
  evaluationId: string,
  repoCommits: { repo: string; commitSha: string }[],
  requirements: EvaluatorState["requirements"],
  github: GitHubReadTool,
): EvaluatorState {
  return {
    claimId,
    evaluationId,
    repoCommits,
    requirements,
    github,
    plan: [],
    toolCallLog: [],
    gatheredFiles: {},
    verdicts: [],
    needsMoreEvidence: false,
    additionalFilesNeeded: [],
    iterationCount: 0,
    error: null,
  };
}
