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

function migrationSql(schemaName: string): string {
  const dir = fileURLToPath(new URL("../migrations", import.meta.url));
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(`${dir}/${file}`, "utf8"))
    .join("\n")
    /* drizzle-kit always fully qualifies CREATE TYPE as `"public"."..."`, and
     * Postgres has no CREATE TYPE ... IF NOT EXISTS — so the enums must be
     * rewritten into this run's schema the way search_path already scopes the
     * (unqualified) tables. */
    .replaceAll('"public".', `"${schemaName}".`)
    /* The breakpoints exist for drizzle's own migrator. Sending the whole file
     * as ONE simple query executes every statement in a single round trip and
     * in one implicit transaction, so a partial failure cannot leave a
     * half-built schema. Safe only because this migration contains nothing that
     * refuses to run inside a transaction (CREATE INDEX CONCURRENTLY, VACUUM). */
    .replaceAll("--> statement-breakpoint", "");
}

async function ensureSchema(): Promise<{ shared: Shared; created: boolean }> {
  if (shared) return { shared, created: false };

  const url = requireUrl();
  /* Name is built from a timestamp and Math.random, never from input, so
   * interpolating it is safe. Postgres has no bind parameter for an identifier,
   * so there is no parameterised alternative. */
  const name = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await withAdmin(url, async (client) => {
    await dropStaleSchemas(client);
    await client.query(`CREATE SCHEMA "${name}"`);
  });

  const pool = new pg.Pool({
    connectionString: url,
    max: 2,
    options: `-c search_path="${name}"`,
  });

  try {
    const client = await pool.connect();
    try {
      await client.query(migrationSql(name));

      const { rows } = await client.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
        [name],
      );
      const tables = rows.map((r) => `"${name}"."${r.tablename}"`).join(", ");

      const built: Shared = {
        name,
        pool,
        db: drizzle(pool, { schema }),
        /* One statement, one round trip, whatever the table count. CASCADE
         * because the tables reference each other; RESTART IDENTITY so nothing
         * carries over in any future sequence-backed column. */
        truncateSql: `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`,
      };
      shared = built;
      return { shared: built, created: true };
    } finally {
      client.release();
    }
  } catch (e) {
    await pool.end();
    await withAdmin(url, (client) =>
      client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`),
    ).catch(() => undefined);
    throw e;
  }
}

/**
 * Runs a test against this file's private schema, emptied first.
 *
 * Isolation is per TEST — every call starts from empty tables — but the schema
 * itself is built once per file. The previous design created and migrated a
 * fresh schema for every call, which cost ~32 round trips per test; against a
 * hosted database that dominated the suite's runtime. It also gave every
 * connection a distinct `search_path` startup parameter, which Supavisor cannot
 * pool across, so pool count grew with the test count until the pooler refused
 * new ones ("max pools count reached"). A stable search_path per file fixes
 * both at once.
 *
 * What this does NOT do is isolate tests from each other *concurrently*. Tests
 * inside a file run sequentially, so TRUNCATE between them is sufficient. Do not
 * add `test.concurrent` to a database test file without revisiting this — two
 * concurrent tests would share a schema and collide on the fixtures' reused
 * unique emails.
 */
export async function withTestSchema<T>(
  fn: (db: TestDb) => Promise<T>,
): Promise<T> {
  const { shared: s, created } = await ensureSchema();

  /* Skipped only on the call that just built the schema — its tables are
   * already empty and TRUNCATE would be a wasted round trip. */
  if (!created) await s.pool.query(s.truncateSql);

  return fn(s.db);
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
