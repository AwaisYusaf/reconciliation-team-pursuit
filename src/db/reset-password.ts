/**
 * Operator password reset (D-24).
 *
 * There is no self-serve reset and no email, so this is the *only* recovery path when the
 * client is locked out — and the only correct response to a suspected credential
 * compromise. It exists as a script rather than a runbook instruction because the second
 * step is the security control: an operator improvising
 * `UPDATE users SET password_hash = …` sets a new password and leaves every existing
 * session row untouched, so an attacker who already has a cookie keeps their access and the
 * "reset" achieves nothing.
 *
 * Falls back to `staff_users` when the email isn't a customer account (Phase 9, D-98), so a
 * locked-out AB Solutions staff member has the same recovery path — the message otherwise
 * reads identically either way.
 *
 *   npm run db:reset-password -- --email team@example.org
 *   npm run db:reset-password -- --email team@example.org --password 'a chosen one'
 *
 * With no --password a strong one is generated and printed once. Run it only after
 * confirming the requester's identity out of band.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const email = argument("email");
  if (!email) {
    throw new Error("Usage: npm run db:reset-password -- --email <address> [--password <value>]");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  // Imported here so the module's production guard is not triggered merely by loading this
  // file, and so the argon2 parameters stay the ones the application itself uses.
  const { generatePassword, hashPassword, validatePasswordPolicy } = await import(
    "@/src/services/auth/passwords"
  );

  const password = argument("password") ?? generatePassword();
  const policyError = validatePasswordPolicy(password);
  if (policyError) throw new Error(policyError);

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    const [user] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = lower(${email})`)
      .limit(1);

    if (user) {
      await db
        .update(schema.users)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(schema.users.id, user.id));

      // The half that makes this a reset rather than a password change: anyone already
      // holding a session for this account loses it, including whoever prompted the reset.
      const revoked = await db
        .delete(schema.sessions)
        .where(eq(schema.sessions.userId, user.id))
        .returning({ id: schema.sessions.id });

      console.log(`Password reset for ${user.email}.`);
      console.log(`Signed out ${revoked.length} active session${revoked.length === 1 ? "" : "s"}.`);
      if (!argument("password")) {
        console.log(`\nNew password (shown once — hand it over out of band):\n\n  ${password}\n`);
      }
      return;
    }

    const [staff] = await db
      .select({ id: schema.staffUsers.id, email: schema.staffUsers.email })
      .from(schema.staffUsers)
      .where(sql`lower(${schema.staffUsers.email}) = lower(${email})`)
      .limit(1);

    if (!staff) throw new Error(`No account found for ${email}`);

    await db
      .update(schema.staffUsers)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(schema.staffUsers.id, staff.id));

    const revoked = await db
      .delete(schema.staffSessions)
      .where(eq(schema.staffSessions.staffUserId, staff.id))
      .returning({ id: schema.staffSessions.id });

    console.log(`Password reset for ${staff.email}.`);
    console.log(`Signed out ${revoked.length} active session${revoked.length === 1 ? "" : "s"}.`);
    if (!argument("password")) {
      console.log(`\nNew password (shown once — hand it over out of band):\n\n  ${password}\n`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
