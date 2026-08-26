/**
 * LangGraph Evaluator — the real implementation.
 *
 * Replaces StubEvaluator. Implements the Evaluator interface from @zkcvp/contracts.
 *
 * Graph: PLAN → GATHER → ANALYZE →(loop?)→ GATHER → ... → FORMAT → END
 *
 * Two nodes use the LLM (PLAN, ANALYZE). Two don't (GATHER, FORMAT).
 * The GitHubReadTool is received via EvaluatorInput — the token is sealed inside it.
 */
import crypto from "node:crypto";
import type {
  Evaluator,
  EvaluatorInput,
  EvidenceBundle,
  Report,
} from "@zkcvp/contracts";

import { createInitialState, type EvaluatorState } from "./state";
import { planNode } from "./nodes/plan";
import { gatherNode } from "./nodes/gather";
import { analyzeNode } from "./nodes/analyze";
import { formatNode } from "./nodes/format";

/** Max GATHER↔ANALYZE loop iterations. */
const MAX_ITERATIONS = 5;

/**
 * The production Evaluator.
 *
 * A plain async function behind the Evaluator interface — the route handler
 * that calls it is a thin adapter (docs/architecture.md).
 */
export class LangGraphEvaluator implements Evaluator {
  async evaluate(
    input: EvaluatorInput,
  ): Promise<{ evidence: EvidenceBundle; report: Report }> {
    const evaluationId = crypto.randomUUID();

    // Initialize state
    let state: EvaluatorState = createInitialState(
      input.claim.claimId,
      evaluationId,
      input.claim.repoCommits,
      input.requirements,
      input.github,
    );

    // ── NODE 1: PLAN ──
    const planResult = await planNode(state);
    state = { ...state, ...planResult };

    // ── LOOP: GATHER → ANALYZE (max MAX_ITERATIONS) ──
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // NODE 2: GATHER
      const gatherResult = await gatherNode(state);
      state = { ...state, ...gatherResult };

      // NODE 3: ANALYZE
      const analyzeResult = await analyzeNode(state);
      state = { ...state, ...analyzeResult };

      // Exit loop if analysis is complete
      if (!state.needsMoreEvidence) break;
    }

    // ── NODE 4: FORMAT ──
    const { evidence, report } = formatNode(state);

    return { evidence, report };
  }
}
