/**
 * Manual integration test for the LangGraph Evaluator.
 *
 * Run with:  GITHUB_TOKEN=ghp_xxx GOOGLE_API_KEY=AIzaSy... npx tsx packages/orchestrator/tests/integration.test.ts
 *
 * Replace the placeholders below with real values before running.
 */
import { LangGraphEvaluator } from "../src/evaluator";
import { createGitHubReadTool } from "../../github/src/read-tool";

// ─── PLACEHOLDERS — fill these in ───────────────────────────────

/** Your GitHub Personal Access Token (repo scope) */
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "ghp_YOUR_TOKEN_HERE";

/** Your Google/Gemini API key — set as env var */
// Set via: export GOOGLE_API_KEY=AIzaSy...  (LangChain reads it automatically)

/** A repo you own — "owner/repo" format */
const TEST_REPO = "PRemSHarma-00/counter-tester";

/** A real commit SHA from that repo — run: git log --oneline -1 */
const TEST_COMMIT_SHA = "5e808456e19fbd53606d65f1763d4cbadcf12044";

// ─── TEST ───────────────────────────────────────────────────────

async function main() {
  console.log("=== ZKCVP Orchestrator Integration Test ===\n");

  // Validate placeholders
  if (GITHUB_TOKEN.includes("YOUR_TOKEN")) {
    console.error("❌ Set GITHUB_TOKEN env var or replace the placeholder");
    process.exit(1);
  }
  if (TEST_REPO.includes("YOUR_REPO")) {
    console.error("❌ Replace TEST_REPO with a real repo (owner/repo)");
    process.exit(1);
  }
  if (TEST_COMMIT_SHA.includes("PASTE")) {
    console.error("❌ Replace TEST_COMMIT_SHA with a real commit SHA");
    process.exit(1);
  }
  const geminiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.error("❌ Set GOOGLE_API_KEY or GEMINI_API_KEY env var");
    process.exit(1);
  }

  // Build the GitHubReadTool (token sealed inside)
  const github = createGitHubReadTool(GITHUB_TOKEN);
  console.log("✅ GitHubReadTool created (token sealed)\n");

  // Quick sanity check — can we read the repo?
  console.log("📂 Testing listTree...");
  try {
    const tree = await github.listTree(TEST_REPO, TEST_COMMIT_SHA);
    console.log(`   Found ${tree.length} entries in repo`);
    console.log(`   First 5: ${tree.slice(0, 5).map((t) => t.path).join(", ")}\n`);
  } catch (err) {
    console.error("❌ listTree failed:", (err as Error).message);
    console.error("   Check: is the token valid? Does the repo/SHA exist?");
    process.exit(1);
  }

  // Run the evaluator
  console.log("🚀 Running LangGraphEvaluator...\n");
  const evaluator = new LangGraphEvaluator();

  const startTime = Date.now();
  const { evidence, report } = await evaluator.evaluate({
    claim: {
      claimId: "test-claim-001",
      repoCommits: [{ repo: "PRemSHarma-00/MediaMate", commitSha: "4f365907431659db3b2ad3475bfb44b09e9c2766" }],
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
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Print results
  console.log(`⏱️  Completed in ${elapsed}s\n`);

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
  for (const call of evidence.toolCallLog) {
    const preview =
      call.result.length > 80
        ? call.result.substring(0, 80) + "..."
        : call.result;
    console.log(`  [${call.at}] ${call.tool}(${JSON.stringify(call.args)}) → ${preview}`);
  }

  console.log("\n✅ Test complete.");
}

main().catch((err) => {
  console.error("\n💥 Test failed:", err);
  process.exit(1);
});
