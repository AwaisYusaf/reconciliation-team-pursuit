import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

declare global {
  // Reused across hot reloads in development so we don't exhaust connections.
  var __ngoExpensesPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env.local");
  }
  return new Pool({ connectionString, max: 10 });
}

const pool = globalThis.__ngoExpensesPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__ngoExpensesPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
export type Database = typeof db;
