/**
 * Development seed — creates the client's organisation so screens have real shapes to render.
 *
 * Idempotent: re-running updates the existing rows rather than duplicating them.
 *
 * The contract figures below are the ones visible in the approved February 2026 packet and
 * are treated as PLACEHOLDERS until Misty confirms the live numbers (decision D-13). Nothing
 * here is client PII: no expenses, no documents, no participant names.
 *
 *   npm run db:seed
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { hash } from "@node-rs/argon2";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";

import { currentMonthKey } from "../domain/dates";
import * as schema from "./schema";

const SEED_EMAIL = process.env.SEED_EMAIL ?? "team@teampursuitglobal.org";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? defaultSeedPassword();

const LINE_ITEMS = [
  { name: "Salary", scheduled: 45869246, opening: 35000000 },
  { name: "Analytical Support", scheduled: 6692914, opening: 4000000 },
  { name: "Promotional & Marketing", scheduled: 5821262, opening: 4819851 },
  { name: "Social Services & Support", scheduled: 4125000, opening: 3000000 },
  { name: "Community Programs & Events", scheduled: 3983245, opening: 1398596 },
  { name: "Professional Development", scheduled: 1500000, opening: 174900 },
];

/** Seeded defaults for the configurable lists (R5.1, R11.1 / D-19). */
const PAYMENT_SOURCES = [
  "Paid by us, reimbursement requested",
  "Invoiced to fiduciary in advance",
  "Paid directly by fiduciary",
];

const SUPPORTING_DOC_TYPES = [
  "Check copy",
  "Request form",
  "Vendor invoice",
  "Event flyer",
  "Narrative",
  "Other",
];

/**
 * The development fallback.
 *
 * Refused in production: this string is in the repository and is printed to stdout, so
 * seeding a production database without setting SEED_PASSWORD would give the single shared
 * account a password anyone reading the source already knows.
 */
function defaultSeedPassword(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SEED_PASSWORD must be set when seeding in production — the development default is " +
        "committed to this repository.",
    );
  }
  return "development-only-password";
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    const existing = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = lower(${SEED_EMAIL})`)
      .limit(1);

    let orgId: string;

    if (existing.length > 0) {
      orgId = existing[0].orgId;
      console.log(`Organisation already seeded (${orgId}) — refreshing configuration.`);
    } else {
      orgId = uuidv7();
      await db.insert(schema.organizations).values({
        id: orgId,
        name: "Team Pursuit Global",
        docName: "Team Pursuit",
        activeMonth: currentMonthKey(),
        onboardedAt: new Date(),
      });
      await db.insert(schema.users).values({
        orgId,
        email: SEED_EMAIL,
        passwordHash: await hash(SEED_PASSWORD),
      });
      console.log(`Created organisation ${orgId} for ${SEED_EMAIL}`);
    }

    await db
      .insert(schema.contractSettings)
      .values({
        orgId,
        projectName: "Community Violence Intervention",
        contractNumber: "6007211",
        basePoNumber: "3086984",
        performancePoNumber: "3089749",
        contractValueCents: 94000000,
        contractStart: "2025-07-01",
        contractEnd: "2026-06-30",
        fiduciaryName: "Detroit Crime Commission",
        perfGrantScheduledCents: 17500000,
        perfGrantBilledCents: 3922950,
        advancesReceivedCents: 66500000,
      })
      .onConflictDoNothing();

    for (const [index, item] of LINE_ITEMS.entries()) {
      await db
        .insert(schema.lineItems)
        .values({
          orgId,
          name: item.name,
          scheduledValueCents: item.scheduled,
          openingBilledCents: item.opening,
          sortOrder: index,
        })
        .onConflictDoNothing();
    }

    for (const [index, label] of PAYMENT_SOURCES.entries()) {
      await db
        .insert(schema.paymentSources)
        .values({ orgId, label, sortOrder: index })
        .onConflictDoNothing();
    }

    for (const [index, label] of SUPPORTING_DOC_TYPES.entries()) {
      await db
        .insert(schema.supportingDocTypes)
        .values({ orgId, label, sortOrder: index })
        .onConflictDoNothing();
    }

    const counts = {
      lineItems: (
        await db.select().from(schema.lineItems).where(eq(schema.lineItems.orgId, orgId))
      ).length,
      paymentSources: (
        await db.select().from(schema.paymentSources).where(eq(schema.paymentSources.orgId, orgId))
      ).length,
      docTypes: (
        await db
          .select()
          .from(schema.supportingDocTypes)
          .where(eq(schema.supportingDocTypes.orgId, orgId))
      ).length,
    };

    console.log(
      `Seeded: ${counts.lineItems} line items, ${counts.paymentSources} payment sources, ${counts.docTypes} document types.`,
    );
    console.log(`Sign in with ${SEED_EMAIL} / ${SEED_PASSWORD}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
