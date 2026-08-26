/**
 * FORMAT node — packages results into EvidenceBundle + Report.
 *
 * 🤖 LLM: NO
 * 📡 GitHub API: NO
 *
 * Takes the accumulated state and produces the two structurally separate
 * output artifacts. Also runs the code-in-rationale guardrail (Layer 3).
 */
import type { EvidenceBundle, Report } from "@zkcvp/contracts";
import type { EvaluatorState } from "../state";
import { containsCode } from "../guardrails/code-detector";

const PROMPT_TEMPLATE_VERSION = "v1";

export function formatNode(state: EvaluatorState): {
  evidence: EvidenceBundle;
  report: Report;
} {
  const { evaluationId, claimId, toolCallLog, verdicts } = state;

  // Guardrail Layer 3: validate no code in rationale
  const sanitizedVerdicts = verdicts.map((v) => {
    if (containsCode(v.rationale)) {
      return {
        ...v,
        rationale:
          "[Rationale redacted — contained source code. " +
          "The requirement was evaluated as: " +
          v.verdict +
          "]",
      };
    }
    return v;
  });

  // Build EvidenceBundle (private — never shown to stakeholder)
  const evidence: EvidenceBundle = {
    evaluationId,
    claimId,
    toolCallLog,
  };

  // Build Report (public — shown to stakeholder immediately)
  const report: Report = {
    evaluationId,
    claimId,
    modelId: state.modelId ?? "gemini-3.5-flash",
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
    createdAt: new Date().toISOString(),
    perRequirement: sanitizedVerdicts.map((v) => ({
      requirementVersionId: v.requirementVersionId,
      verdict: v.verdict,
      rationale: v.rationale,
    })),
  };

  return { evidence, report };
}
