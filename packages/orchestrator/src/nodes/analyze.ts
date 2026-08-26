/**
 * ANALYZE node — evaluates each requirement against gathered evidence.
 *
 * 🤖 LLM: YES (reads evidence, produces verdict + rationale per requirement)
 * 📡 GitHub API: NO
 *
 * The core intelligence of the evaluator. For each requirement:
 * - Receives all gathered file contents
 * - Determines: satisfied or not_satisfied
 * - Writes a rationale in natural language (NO code allowed)
 * - Can request additional files if evidence is insufficient
 */
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import type { EvaluatorState } from "../state";

const RequirementVerdictSchema = z.object({
  requirementVersionId: z.string(),
  verdict: z.enum(["satisfied", "not_satisfied"]),
  rationale: z.string().describe(
    "Natural language explanation. Reference file paths and line ranges only. NEVER include verbatim source code, function signatures, variable names, or code snippets.",
  ),
});

const AnalysisOutputSchema = z.object({
  verdicts: z.array(RequirementVerdictSchema),
  needsMoreEvidence: z.boolean().describe(
    "True only if you genuinely cannot make a determination with the current evidence",
  ),
  additionalFilesNeeded: z
    .array(z.string())
    .describe("File paths to read if needsMoreEvidence is true. Empty otherwise."),
});

/** Max iterations before forcing output. */
const MAX_ITERATIONS = 5;

export async function analyzeNode(
  state: EvaluatorState,
): Promise<Partial<EvaluatorState>> {
  const { requirements, gatheredFiles, iterationCount } = state;

  // Build the evidence section
  const evidenceText = Object.entries(gatheredFiles)
    .map(([path, content]) => `=== ${path} ===\n${content}`)
    .join("\n\n");

  const requirementsList = requirements
    .map(
      (r) =>
        `- ID: ${r.requirementVersionId}\n  Title: ${r.title}\n  Description: ${r.description}`,
    )
    .join("\n\n");

  const forceDecision = iterationCount >= MAX_ITERATIONS;

  const prompt = `You are a code evaluator. Your job is to determine whether gathered source code evidence satisfies each requirement.

REQUIREMENTS:
${requirementsList}

EVIDENCE (file contents from the repository):
${evidenceText}

RULES:
1. Evaluate EACH requirement independently. Return a separate verdict for each.
2. Verdict must be exactly "satisfied" or "not_satisfied".
3. Your rationale MUST be in natural language ONLY. You may reference file paths (e.g. "src/auth.ts, lines 15-30") but NEVER paste, quote, or reproduce any actual source code, variable names, function signatures, import statements, or code snippets of any kind.
4. ${forceDecision ? "You MUST make a final decision now. Set needsMoreEvidence to false." : "If you genuinely cannot determine a verdict with the current evidence, set needsMoreEvidence to true and list specific files you need."}
5. Be rigorous but fair. A requirement is "satisfied" if the code demonstrates a reasonable implementation of what's described, not necessarily a perfect one.`;

  const llm = new ChatGoogleGenerativeAI({
    model: state.modelId ?? "gemini-3.5-flash",
    temperature: 0,
  });

  const structured = llm.withStructuredOutput(AnalysisOutputSchema);
  const result = await structured.invoke(prompt);

  return {
    verdicts: result.verdicts,
    needsMoreEvidence: forceDecision ? false : result.needsMoreEvidence,
    additionalFilesNeeded: forceDecision ? [] : result.additionalFilesNeeded,
  };
}
