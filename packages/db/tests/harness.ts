// packages/db/tests/harness.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import * as schema from "../src/schema/index";
import type { Db } from "../src/client";

/**
 * Same type as production `Db` (not just structurally similar `NodePgDatabase<
 * typeof schema>`, which is missing `$client`) — every function under test
 * takes `db: Db`, so the harness must hand back exactly that type or callers
 * need a cast at every call site.
 */
export type TestDb = Db;

/** How long a schema may linger before a later run treats it as abandoned. */
const STALE_AFTER_MS = 60 * 60 * 1000;

type Shared = {
  name: string;
  pool: pg.Pool;
  db: TestDb;
  /** Built once from the schema's real table list. */
  truncateSql: string;
};

/**
 * ONE schema per test FILE, not per test.
 *
 * Vitest parallelises by file and runs the tests inside a file sequentially
 * (nothing here opts into `test.concurrent`), and with `isolate: true` each
 * file gets a fresh module registry — so this module-level value is naturally
 * scoped to exactly one file. Tests inside that file share the schema and are
 * separated by TRUNCATE instead.
 */
let shared: Shared | undefined;

function requireUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to run database tests");
  return url;
}

/** Short-lived single connection for DDL that must not run inside the run's schema. */
async function withAdmin<T>(
  url: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Drops schemas abandoned by a killed run.
 *
 * Age-gated on the timestamp embedded in the name, because several workers do
 * this concurrently and each one's own schema is seconds old — an ungated sweep
 * would delete a sibling worker's live schema mid-test.
 */
async function dropStaleSchemas(client: pg.Client): Promise<void> {
  const cutoff = Date.now() - STALE_AFTER_MS;
  const { rows } = await client.query<{ nspname: string }>(
    `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'test\\_%'`,
  );

  for (const { nspname } of rows) {
    const createdAt = Number(nspname.split("_")[1]);
    if (!Number.isFinite(createdAt) || createdAt >= cutoff) continue;
    /* Another worker may be sweeping the same schema; losing that race is fine. */
    await client
      .query(`DROP SCHEMA IF EXISTS "${nspname}" CASCADE`)
      .catch(() => undefined);
  }
}



/**
 * Drops this file's schema and closes its pool.
 *
 * Called from an `afterAll` in the Vitest setup file, which runs once per test
 * file. Without it the module-level pool would keep the worker's event loop
 * alive and Vitest would hang at exit.
 */
export async function releaseTestSchema(): Promise<void> {
  if (!shared) return;
  const { name, pool } = shared;
  shared = undefined;

  await pool.end();
  await withAdmin(requireUrl(), (client) =>
    client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`),
  );
}
