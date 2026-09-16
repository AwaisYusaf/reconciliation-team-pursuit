import "server-only";

import { sql } from "drizzle-orm";

import { db, type Database } from "@/src/db";
import { staffUsers, users } from "@/src/db/schema";

/**
 * Whether an email belongs to a customer account or a staff account (Phase 9 §3.3) —
 * emails are unique across both `users` and `staff_users`, even though no single database
 * constraint spans the two tables.
 *
 * `reader` defaults to the shared `db` handle but accepts a transaction or a script's own
 * pool, so callers checking-then-inserting inside a transaction see their own uncommitted
 * writes.
 *
 * ponytail: no constraint spans both tables, so a customer signup and a `db:create-staff` run
 * for the same address at the same instant can both pass this check and both succeed. That
 * race needs an operator script running concurrently with a signup, which is rare enough to
 * accept rather than add a cross-table constraint for.
 */
export async function emailInUse(
  email: string,
  reader: Pick<Database, "select"> = db,
): Promise<boolean> {
  const [customer] = await reader
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  if (customer) return true;

  const [staff] = await reader
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(sql`lower(${staffUsers.email}) = lower(${email})`)
    .limit(1);
  return Boolean(staff);
}
