import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: "./packages/db/.env" });

export default defineConfig({
  test: {
    include: ["{apps,packages}/*/tests/**/*.test.ts"],
    /* The design system has its own render check (`npm run verify -w
     * @zkcvp/design-system-ledger`) which server-renders real markup. It is not
     * a Vitest suite and is not collected here.
     *
     * packages/orchestrator/tests/integration.test.ts is a MANUAL script, not a
     * suite — its own header says to run it with
     * `GITHUB_TOKEN=... GOOGLE_API_KEY=... npx tsx`. It hits a live repo and a
     * live LLM, so collecting it here would make the suite fail for anyone
     * without both credentials. Run it by hand when you want it. */
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "packages/orchestrator/tests/**",
    ],

    /* Drops each test file's database schema and closes its pool when the file
     * finishes. Required, not bookkeeping: the harness holds a pg.Pool in module
     * scope, and an open pool keeps the worker's event loop alive — without this
     * Vitest hangs at exit. Harmless for the files that never touch a database. */
    setupFiles: ["./packages/db/tests/setup.ts"],

    /* File parallelism is deliberately UNCAPPED, and that is only safe because
     * of how packages/db/tests/harness.ts is written. Read this before adding a
     * cap back.
     *
     * The harness builds one schema per test FILE and separates the tests inside
     * it with TRUNCATE. So the database cost is one small pool (max 2) per
     * in-flight file — roughly 18 connections across the 9 files that touch the
     * database — and it is flat: it does not grow with the test count.
     *
     * It used to. An earlier harness created a fresh schema per TEST, which gave
     * every connection a distinct `search_path` startup parameter. Supavisor
     * cannot share a backend between clients whose startup parameters differ, so
     * pool count grew with the test count until the pooler refused new ones. That
     * forced maxWorkers down to 2, and the measurements were:
     *
     *   workers │ result │ connection errors │ wall
     *   ────────┼────────┼───────────────────┼──────
     *      6    │ 64/96  │ many              │  93s
     *      3    │ 64/96  │ many              │ 138s
     *      2    │ 96/96  │ NONE              │ 327s
     *
     * Note what that table shows: MORE workers looked faster while failing. The
     * failures arrive as a dozen scattered, unrelated-looking test errors rather
     * than an obvious resource message, so a green run is the only evidence that
     * counts here. Switching the endpoint from the transaction pooler (:6543) to
     * session mode (:5432) was tried and changed nothing.
     *
     * If connection errors ever return, the fix is to look at what the harness
     * opens per file — capping workers only hides it. */
  },
});
