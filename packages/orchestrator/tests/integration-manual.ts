/**
 * Manual end-to-end check for the LangGraph Evaluator.
 *
 * NOT a Vitest suite, and deliberately not named like one: it hits a live repo
 * and a live model, so collecting it would make `npm run test` fail for anyone
 * without both credentials. The collectable tests live beside it in
 * `*.test.ts` and need neither.
 *
 * Run with:
 *   GITHUB_TOKEN=ghp_xxx GOOGLE_API_KEY=AIzaSy... \
 *     npx tsx packages/orchestrator/tests/integration-manual.ts
 */
import { EvaluationError } from "@zkcvp/contracts";

import { LangGraphEvaluator } from "../src/evaluator";
import { createGitHubReadTool } from "../../github/src/read-tool";

// ─── PLACEHOLDERS — fill these in ───────────────────────────────

/** Your GitHub Personal Access Token (repo scope). */
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "ghp_YOUR_TOKEN_HERE";

/** A repo you own — "owner/repo" format. */
const TEST_REPO = process.env.TEST_REPO || "PRemSHarma-00/MediaMate";

/** A real commit SHA from THAT repo — run: git log --oneline -1 */
const TEST_COMMIT_SHA =
  process.env.TEST_COMMIT_SHA || "4f365907431659db3b2ad3475bfb44b09e9c2766";

/** Mirrors the app's EVAL_CEILING_SECONDS default. */
const BUDGET_SECONDS = Number(process.env.EVAL_CEILING_SECONDS ?? 300);

/** Mirrors the app's EVAL_MODEL_ID default. */
const MODEL_ID = process.env.EVAL_MODEL_ID ?? "gemini-3.5-flash";

// ─── TEST ───────────────────────────────────────────────────────

async function main() {
  console.log("=== ZKCVP Orchestrator Integration Test ===\n");

  if (GITHUB_TOKEN.includes("YOUR_TOKEN")) {
    console.error("❌ Set GITHUB_TOKEN env var or replace the placeholder");
    process.exit(1);
  }
  if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    console.error("❌ Set GOOGLE_API_KEY or GEMINI_API_KEY env var");
    process.exit(1);
  }

  const deadline = new Date(Date.now() + BUDGET_SECONDS * 1000);
  const github = createGitHubReadTool(GITHUB_TOKEN, { deadline });
  console.log("✅ GitHubReadTool created (token sealed)\n");

  console.log("📂 Testing listTree...");
  try {
    const tree = await github.listTree(TEST_REPO, TEST_COMMIT_SHA);
    console.log(`   Found ${tree.entries.length} entries${tree.truncated ? " (truncated by GitHub)" : ""}`);
    console.log(
      `   First 5: ${tree.entries.slice(0, 5).map((t) => t.path).join(", ")}\n`,
    );
  } catch (err) {
    console.error("❌ listTree failed:", (err as Error).message);
    console.error("   Check: is the token valid? Does the repo/SHA exist?");
    process.exit(1);
  }

  console.log("🚀 Running LangGraphEvaluator...\n");
  const evaluator = new LangGraphEvaluator();
  const startTime = Date.now();

  // The same repo and SHA the sanity check above used — a mismatch here reads
  // as an evaluator bug when it is really a typo in the harness.
  const input = {
    claim: {
      claimId: "test-claim-001",
      repoCommits: [{ repo: TEST_REPO, commitSha: TEST_COMMIT_SHA }],
    },
    requirements: [
      {
        requirementVersionId: "req-v1",
        title: "User authentication",
        description:
          "The app must implement user authentication with sign-up, login, and protected routes that prevent unauthenticated users from accessing the dashboard",
      },
      {
        requirementVersionId: "req-v2",
        title: "Watchlist management",
        description:
          "Users must be able to add media items to a personal watchlist, view their watchlist, and remove items from it",
      },
      {
        requirementVersionId: "req-v3",
        title: "External API integration",
        description:
          "The app must fetch media data (movies, TV shows, or similar) from an external third-party API rather than using only hardcoded or local data",
      },
    ],
    github,
    modelId: MODEL_ID,
    deadline,
  };

  // Streamed, so a run that stalls shows where. `evaluate()` takes the same
  // path without the progress events.
  const run = evaluator.evaluateStream(input);
  let step = await run.next();
  while (!step.done) {
    const p = step.value;
    console.log(
      `   … ${p.node.padEnd(8)} round ${p.iteration}, ${p.filesGathered} file(s) read`,
    );
    step = await run.next();
  }
  const { evidence, report } = step.value;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⏱️  Completed in ${elapsed}s\n`);

  console.log("═══ REPORT ═══════════════════════════════════");
  console.log(`Evaluation ID: ${report.evaluationId}`);
  console.log(`Claim ID:      ${report.claimId}`);
  console.log(`Model:         ${report.modelId}`);
  console.log(`Prompt:        ${report.promptTemplateVersion}`);
  console.log(`Created:       ${report.createdAt}\n`);

  for (const req of report.perRequirement) {
    const icon = req.verdict === "satisfied" ? "✅" : "❌";
    console.log(`${icon} [${req.requirementVersionId}] ${req.verdict}`);
    console.log(`   Rationale: ${req.rationale}\n`);
  }

  console.log("═══ EVIDENCE BUNDLE ══════════════════════════");
  console.log(`Tool calls made: ${evidence.toolCallLog.length}`);
  console.log(`Plan reasoning:  ${evidence.planReasoning}`);
  if (evidence.droppedPaths.length > 0) {
    console.log(`Dropped paths:   ${evidence.droppedPaths.length}`);
    for (const d of evidence.droppedPaths) console.log(`  - ${d}`);
  }
  for (const call of evidence.toolCallLog) {
    const preview =
      call.result.length > 80 ? call.result.substring(0, 80) + "..." : call.result;
    console.log(
      `  [${call.outcome}] ${call.tool}(${JSON.stringify(call.args)}) → ${preview.replace(/\n/g, " ")}`,
    );
  }

  console.log("\n✅ Test complete.");
}

main().catch((err) => {
  // A failed evaluation is not a failed verdict, and the two print differently
  // on purpose — see PRODUCT.md principle 2.
  if (err instanceof EvaluationError) {
    console.error(`\n🛑 Evaluation did not complete — ${err.kind}: ${err.message}`);
    if (err.retryAt) console.error(`   Retry after: ${err.retryAt}`);
    process.exit(2);
  }
  console.error("\n💥 Test failed:", err);
  process.exit(1);
});
