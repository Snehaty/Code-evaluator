/**
 * LangGraph Evaluator — the real implementation.
 *
 * Graph: PLAN → GATHER → ANALYZE →(loop?)→ GATHER → ... → FORMAT → END
 *
 * Two nodes use the LLM (PLAN, ANALYZE). Two don't (GATHER, FORMAT).
 * The GitHubReadTool arrives via EvaluatorInput and is handed to the run as
 * context rather than as state, so the token never enters a channel.
 */
import crypto from "node:crypto";
import { END, START, StateGraph } from "@langchain/langgraph";
import type {
  Evaluator,
  EvaluatorInput,
  EvidenceBundle,
  Report,
} from "@zkcvp/contracts";
import { EvaluationError } from "@zkcvp/contracts";

import { DEFAULT_MODEL_ID, type RunContext } from "./context";
import { RECURSION_LIMIT } from "./limits";
import { analyzeNode } from "./nodes/analyze";
import { formatNode } from "./nodes/format";
import { gatherNode } from "./nodes/gather";
import { planNode } from "./nodes/plan";
import { EvaluatorAnnotation, type EvaluatorState } from "./state";
import { assertOneCommitPerRepo } from "./validation";

/**
 * The compiled graph.
 *
 * Built once at module scope: compilation is pure, and rebuilding it per
 * request would allocate the whole topology on every claim submission.
 */
const graph = new StateGraph(EvaluatorAnnotation)
  .addNode("plan", planNode)
  .addNode("gather", gatherNode)
  .addNode("analyze", analyzeNode)
  .addNode("format", formatNode)
  .addEdge(START, "plan")
  .addEdge("plan", "gather")
  .addEdge("gather", "analyze")
  .addConditionalEdges(
    "analyze",
    // The iteration cap is enforced inside ANALYZE, which clears the flag it
    // would otherwise route on — so the cap cannot be talked past here either.
    (state: EvaluatorState) => (state.needsMoreEvidence ? "gather" : "format"),
    { gather: "gather", format: "format" },
  )
  .addEdge("format", END)
  .compile();

/** Progress event for a caller that wants to show the run happening. */
export type EvaluationProgress = {
  node: "plan" | "gather" | "analyze" | "format";
  /** Files read so far, across every round. */
  filesGathered: number;
  /** Completed GATHER↔ANALYZE rounds. */
  iteration: number;
};

function initialState(
  input: EvaluatorInput,
  evaluationId: string,
): Partial<EvaluatorState> {
  return {
    claimId: input.claim.claimId,
    evaluationId,
    repoCommits: input.claim.repoCommits,
    requirements: input.requirements,
  };
}

function buildContext(input: EvaluatorInput): RunContext {
  return {
    github: input.github,
    modelId: input.modelId ?? DEFAULT_MODEL_ID,
    deadline: input.deadline,
  };
}

function runConfig(context: RunContext, signal?: AbortSignal) {
  return {
    configurable: context,
    recursionLimit: RECURSION_LIMIT,
    signal,
  };
}

/**
 * Both artifacts, or an error. Never a partial Report — see EvaluationError.
 */
function harvest(state: EvaluatorState): {
  evidence: EvidenceBundle;
  report: Report;
} {
  if (!state.evidence || !state.report) {
    throw new EvaluationError(
      "model_unavailable",
      "The evaluation graph finished without producing a report",
    );
  }
  return { evidence: state.evidence, report: state.report };
}

/**
 * The production Evaluator.
 *
 * The route handler that calls it stays a thin adapter (docs/architecture.md):
 * moving between a serverless host and a long-lived Node host changes where
 * this is invoked from, not what it is.
 */
export class LangGraphEvaluator implements Evaluator {
  async evaluate(
    input: EvaluatorInput,
  ): Promise<{ evidence: EvidenceBundle; report: Report }> {
    assertOneCommitPerRepo(input.claim.repoCommits);
    if (input.requirements.length === 0) {
      throw new EvaluationError(
        "invalid_input",
        "A claim must name at least one requirement",
      );
    }

    const evaluationId = crypto.randomUUID();
    const context = buildContext(input);

    const final = (await graph.invoke(
      initialState(input, evaluationId),
      runConfig(context, input.signal),
    )) as EvaluatorState;

    return harvest(final);
  }

  /**
   * The same run, reporting each node as it completes.
   *
   * Exists because the wait is minutes long and otherwise invisible. It streams
   * PROGRESS, not results: the artifacts arrive once, at the end, from the same
   * all-or-nothing rule that governs `evaluate()`.
   */
  async *evaluateStream(
    input: EvaluatorInput,
  ): AsyncGenerator<
    EvaluationProgress,
    { evidence: EvidenceBundle; report: Report }
  > {
    assertOneCommitPerRepo(input.claim.repoCommits);
    if (input.requirements.length === 0) {
      throw new EvaluationError(
        "invalid_input",
        "A claim must name at least one requirement",
      );
    }

    const evaluationId = crypto.randomUUID();
    const context = buildContext(input);

    let latest: EvaluatorState | null = null;

    const stream = await graph.stream(
      initialState(input, evaluationId),
      { ...runConfig(context, input.signal), streamMode: "values" },
    );

    for await (const value of stream) {
      const state = value as EvaluatorState;
      latest = state;
      yield {
        node: state.report
          ? "format"
          : state.verdicts.length > 0
            ? "analyze"
            : Object.keys(state.gatheredFiles).length > 0
              ? "gather"
              : "plan",
        filesGathered: Object.keys(state.gatheredFiles).length,
        iteration: state.iterationCount,
      };
    }

    if (!latest) {
      throw new EvaluationError(
        "model_unavailable",
        "The evaluation graph produced no state",
      );
    }
    return harvest(latest);
  }
}
