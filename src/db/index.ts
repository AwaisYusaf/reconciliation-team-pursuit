import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

declare global {
  // Reused across hot reloads in development so we don't exhaust connections.
  var __ngoExpensesPool: Pool | undefined;
}

type Db = NodePgDatabase<typeof schema>;

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  }
  return new Pool({ connectionString, max: 10 });
}

let connected: Db | undefined;

function connection(): Db {
  if (connected) return connected;
  const pool = globalThis.__ngoExpensesPool ?? createPool();
  if (process.env.NODE_ENV !== "production") globalThis.__ngoExpensesPool = pool;
  connected = drizzle(pool, { schema });
  return connected;
}

/**
 * The database handle, connected on first use rather than on import.
 *
 * It has to be lazy. `next build` collects page data by importing every route module, with
 * none of the runtime environment present — so connecting at import time failed the
 * production build on `/login` with "DATABASE_URL is not set", for a page that never queries
 * anything. Nothing is lost by waiting: `pg.Pool` does not open a socket until the first
 * query either way, and a missing URL is still caught before a request is served, by
 * `instrumentation.ts` at startup.
 *
 * A proxy rather than a `getDb()` function so all 42 call sites keep reading `db.select(…)`.
 * Methods are bound to the real instance, because Drizzle's builders depend on their own
 * `this` and would otherwise receive the proxy.
 */
export const db = new Proxy({} as Db, {
  get(_target, property) {
    const real = connection();
    const value = Reflect.get(real, property) as unknown;
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
export type Database = Db;
