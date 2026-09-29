/**
 * Operator script: create an AB Solutions staff account (Phase 9, D-98).
 *
 * There is no staff sign-up — the developer creates every staff account by hand, the same
 * model `db:reset-password` already uses for password recovery.
 *
 *   npm run db:create-staff -- --email awais@example.org --name "Awais Khan"
 *   npm run db:create-staff -- --email awais@example.org --name "Awais Khan" --password 'a chosen one'
 *
 * With no --password a strong one is generated and printed once. Run only after confirming
 * the requester's identity out of band.
 *
 * `deploy.sh` runs it as `--skip-existing`, reading STAFF_EMAIL, STAFF_NAME and STAFF_PASSWORD
 * from the environment. That mode is idempotent: an existing account is left exactly as it is,
 * password included, and no STAFF_EMAIL means there is nothing to create. An address that
 * belongs to a customer is still refused.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { z } from "zod";

import { isUniqueViolation } from "./pg-errors";
import * as schema from "./schema";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const emailSchema = z.string().trim().max(320).email();

async function main() {
  // Flags win over the environment, so an operator on the box can always create a second
  // account by hand without touching .env.
  const skipExisting = hasFlag("skip-existing");
  const rawEmail = argument("email") ?? process.env.STAFF_EMAIL;
  const rawName = argument("name") ?? process.env.STAFF_NAME;

  if (skipExisting && !rawEmail) {
    console.log("No STAFF_EMAIL configured, so there is no staff account to create.");
    return;
  }

  if (!rawEmail || !rawName) {
    throw new Error(
      "Usage: npm run db:create-staff -- --email <address> --name <name> [--password <value>]\n" +
        "       (or set STAFF_EMAIL, STAFF_NAME and STAFF_PASSWORD in the environment)",
    );
  }

  const parsedEmail = emailSchema.safeParse(rawEmail);
  if (!parsedEmail.success) throw new Error("Enter a valid email address.");
  const email = parsedEmail.data;

  // Imported here (not statically) for the same reason reset-password.ts does — module
  // loading is deferred past the dotenv config above, and the argon2 parameters stay the
  // ones the application itself uses.
  const { nameSchema } = await import("@/src/domain/name");
  const parsedName = nameSchema.safeParse(rawName);
  if (!parsedName.success) throw new Error(parsedName.error.issues[0]?.message ?? "Enter a name.");
  const name = parsedName.data;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const { generatePassword, hashPassword, validatePasswordPolicy } = await import(
    "@/src/services/auth/passwords"
  );
  const { emailInUse } = await import("@/src/modules/auth/emails");

  // An unset STAFF_PASSWORD in a `.env` arrives as "" rather than undefined, which `??` passes
  // straight through to the policy check — so a redeploy with the line present but blank used
  // to fail on a password nothing was going to use.
  const rawPassword = argument("password") ?? process.env.STAFF_PASSWORD;
  const suppliedPassword = rawPassword && rawPassword.trim() !== "" ? rawPassword : undefined;

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    // Existence is checked BEFORE anything to do with the password: on a redeploy the account
    // already exists and no password is needed at all, so a missing or weak one must not turn
    // an idempotent no-op into a failed deploy step.
    const [existingStaff] = await db
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(sql`lower(${schema.staffUsers.email}) = lower(${email})`)
      .limit(1);

    if (existingStaff) {
      // Idempotent on a redeploy: left exactly as it is, password included.
      if (skipExisting) {
        console.log(`Staff account for ${email} already exists. Left unchanged.`);
        return;
      }
      throw new Error(`An account already exists for ${email}`);
    }

    // A customer owns this address: refused even under --skip-existing, because one address
    // cannot be both and silently skipping would leave `/a` with no account and no complaint.
    if (await emailInUse(email, db)) {
      throw new Error(`An account already exists for ${email}`);
    }

    // From here an account really is being created, so a password is required.
    //
    // Under `--skip-existing` (the deploy path) one is never generated: the only way to hand a
    // generated password over is to print it, and that would put it in the deploy log and in
    // whatever CI keeps. An operator running this by hand still gets one printed once.
    if (skipExisting && !suppliedPassword) {
      throw new Error(
        `STAFF_EMAIL is set to ${email} but STAFF_PASSWORD is empty, so no account was created. ` +
          "Set STAFF_PASSWORD in .env and deploy again, or create the account by hand with " +
          "npm run db:create-staff -- --email <address> --name <name>",
      );
    }

    const password = suppliedPassword ?? generatePassword();
    const policyError = validatePasswordPolicy(password);
    if (policyError) throw new Error(policyError);

    let staffId: string;
    try {
      const [created] = await db
        .insert(schema.staffUsers)
        .values({ email, name, passwordHash: await hashPassword(password) })
        .returning({ id: schema.staffUsers.id });
      staffId = created.id;
    } catch (error) {
      // The unique-index race: two creates for the same email land within the same window.
      // Only a unique violation (23505, raw or wrapped as Drizzle's `cause`) means that; any
      // other failure is rethrown so it isn't misreported as a duplicate.
      if (isUniqueViolation(error)) {
        throw new Error(`An account already exists for ${email}`);
      }
      throw error;
    }

    console.log(`Staff account created for ${email} (${staffId}).`);
    // Only a generated one is printed — a password that came from a flag or the environment is
    // already known to whoever set it, and printing it would put it in the deploy log.
    if (!suppliedPassword) {
      console.log(`\nPassword (shown once, hand it over out of band):\n\n  ${password}\n`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
