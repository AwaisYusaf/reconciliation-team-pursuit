/**
 * `SELECT ... FOR UPDATE` on `organizations`, shared by every writer that needs to serialise
 * itself per org (Phase 15, P12): staff account actions (`src/modules/admin/actions.ts`,
 * originally a private `withLockedOrg`) and, from Phase 3 and 6 on, funding-source create and
 * unarchive and the billing actions. Not `"use server"`: this is a database helper, and every
 * export of a `"use server"` file is a public endpoint.
 */
import { eq } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/pg-core";
import type { SelectResult } from "drizzle-orm/query-builders/select.types";

import { type Database } from "@/src/db";
import { organizations } from "@/src/db/schema";

/** An open transaction's handle. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Either the pooled handle or an open transaction's, same trick as `funding-sources/queries.ts`. */
export type Executor = Database | Transaction;

/**
 * Locks the organisation row until `tx` ends and returns the columns `fields` selects, or
 * `undefined` when the id doesn't exist. Takes a transaction, never the pool: a row lock taken
 * outside one is released the moment the statement ends. Callers check the id is a uuid first,
 * so a non-uuid never reaches the database.
 *
 * The return type is spelled out because drizzle can't infer a select over a generic `fields`;
 * it is exactly what `tx.select(fields).from(organizations)` returns for a concrete selection.
 */
export async function lockOrg<T extends SelectedFields>(
  tx: Transaction,
  orgId: string,
  fields: T,
): Promise<SelectResult<T, "partial", Record<"organizations", "not-null">> | undefined> {
  const rows = await tx.select(fields as SelectedFields).from(organizations).where(eq(organizations.id, orgId)).for("update");
  return rows[0] as SelectResult<T, "partial", Record<"organizations", "not-null">> | undefined;
}
