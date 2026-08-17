// packages/db/tests/setup.ts
import { afterAll } from "vitest";
import { releaseTestSchema } from "./harness";

/**
 * Vitest runs a setup file once per TEST FILE, so this `afterAll` fires when
 * each file finishes — which is exactly the lifetime of the schema the harness
 * builds lazily in module scope.
 *
 * It is registered for every test file, including the ones that never touch a
 * database; `releaseTestSchema` is a no-op when no schema was created.
 *
 * This is not optional bookkeeping. The harness holds a `pg.Pool` in module
 * scope, and an open pool keeps the worker's event loop alive — without this,
 * Vitest hangs at exit instead of finishing.
 */
afterAll(async () => {
  await releaseTestSchema();
});
