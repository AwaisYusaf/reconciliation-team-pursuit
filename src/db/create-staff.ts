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
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";

import * as schema from "./schema";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const emailSchema = z.string().trim().max(320).email();

async function main() {
  const rawEmail = argument("email");
  const rawName = argument("name");
  if (!rawEmail || !rawName) {
    throw new Error(
      "Usage: npm run db:create-staff -- --email <address> --name <name> [--password <value>]",
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

  const password = argument("password") ?? generatePassword();
  const policyError = validatePasswordPolicy(password);
  if (policyError) throw new Error(policyError);

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    if (await emailInUse(email, db)) {
      throw new Error(`An account already exists for ${email}`);
    }

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
      const code = (value: unknown) => (value as { code?: unknown } | undefined)?.code;
      if (code(error) === "23505" || code((error as { cause?: unknown }).cause) === "23505") {
        throw new Error(`An account already exists for ${email}`);
      }
      throw error;
    }

    console.log(`Staff account created for ${email} (${staffId}).`);
    if (!argument("password")) {
      console.log(`\nPassword (shown once — hand it over out of band):\n\n  ${password}\n`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
