/**
 * Development fixture — realistic expenses so screens can be built and checked against
 * the published February 2026 figures.
 *
 * NOT a product feature: the prototype's "load sample data" affordance was deliberately
 * dropped (D-23), and this script is never reachable from the app. It is also PII-free by
 * construction — only business vendor names and the per-line-item totals that already
 * appear in the specification. No participant names, no real people.
 *
 *   npm run db:fixture          seed February expenses
 *   npm run db:fixture -- clear remove them again
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const MONTH = "2026-02";
const SOURCE = "Paid by us, reimbursement requested";

/**
 * The published "This Period" total for each line item (docs/03-modules/m07).
 * The fixture asserts against these before inserting, so it cannot drift away from the
 * specification without failing loudly.
 */
const EXPECTED_TOTALS: Record<string, number> = {
  Salary: 4564112,
  "Analytical Support": 1989083,
  "Promotional & Marketing": 1185165,
  "Social Services & Support": 1023108,
  "Community Programs & Events": 425128,
  "Professional Development": 159900,
};

/** Each entry's amounts sum to that line item's published "This Period" total. */
const FIXTURE: Array<{ lineItem: string; rows: Array<[name: string, description: string, cents: number]> }> = [
  {
    lineItem: "Salary",
    rows: [
      ["Payroll — Pay Period 1", "Bi-weekly payroll for programme staff", 2282056],
      ["Payroll — Pay Period 2", "Bi-weekly payroll for programme staff", 2282056],
    ],
  },
  {
    lineItem: "Analytical Support",
    rows: [
      ["IE Creatives", "Environment and tools to support initiatives and events", 315000],
      ["AB Solutions", "Core platform infrastructure setup", 850000],
      ["Hi Res Models", "Ongoing support of events with tools and systems", 350000],
      ["Hiscox", "Insurance for systems and programmes", 9300],
      ["HL Pro Tools", "Software for team management and analytics", 49700],
      ["Emerald Sims", "Analytical and administrative support", 136000],
      ["Mantaq", "Contracted development support", 250000],
      ["Adobe", "Software for document generation and formatting", 9999],
      ["Reimbursed Purchases", "Out-of-pocket purchases reimbursed", 19084],
    ],
  },
  {
    lineItem: "Promotional & Marketing",
    rows: [
      ["Google Workspace", "Workspace tooling for outreach", 50400],
      ["High Level", "Agency sales and marketing platform", 69500],
      ["JDS Silkscreen & Embroidery", "Branded apparel for staff at events", 331300],
      ["Zoom", "Video meetings for internal and community use", 2951],
      ["Canva", "Design tool for canvassing materials", 11940],
      ["Stock Media", "Digital marketing strategy and analytics", 150000],
      ["Zapier", "Automation tooling for outreach campaigns", 7350],
      ["Descript", "Video and audio editing software", 3500],
      ["ClickUp", "Workflow management", 43900],
      ["Intuit", "Staff hours and assignment management", 38650],
      ["Loom", "Video communication for record keeping", 24000],
      ["Read", "Meeting and email assistant", 2975],
      ["FedEx", "Copying of promotional material", 4990],
      ["Master Key Marketing", "Training platform subscription", 19700],
      ["Blinq", "Digital and physical branding management", 4893],
      ["Payoneer", "Team coordination tooling", 125375],
      ["Smith Anderson", "Magazine and media-based outreach", 200000],
      ["Content Creator", "Social media setup and management", 25000],
      ["Katie Cross Media", "Marketing support", 11400],
      ["Develop Architecture LLC", "Design and planning for community event space", 25000],
      ["Johnathan Sarong", "Outreach development support", 28999],
      ["Community Print Shop", "Printed outreach materials", 3342],
    ],
  },
  {
    lineItem: "Social Services & Support",
    rows: [
      ["Case Management Services", "Contracted case management for participants", 620000],
      ["Family Support Vendor", "Wraparound services for participant families", 300000],
      ["Community Grocers", "Groceries for participant families", 42108],
      ["Metro Transit Services", "Transportation for programme participants", 61000],
    ],
  },
  {
    lineItem: "Community Programs & Events",
    rows: [
      ["Community Event Rental", "Venue rental for community programming", 300000],
      ["Riverside Catering", "Catering for a community event", 125128],
    ],
  },
  {
    lineItem: "Professional Development",
    rows: [["Training Provider", "Staff training and professional development", 159900]],
  },
];

/** Fail before touching the database if any group stops matching the published figure. */
function assertTotals(): void {
  const problems: string[] = [];
  for (const group of FIXTURE) {
    const actual = group.rows.reduce((sum, [, , cents]) => sum + cents, 0);
    const expected = EXPECTED_TOTALS[group.lineItem];
    if (expected === undefined) {
      problems.push(`${group.lineItem}: no published total to check against`);
    } else if (actual !== expected) {
      problems.push(
        `${group.lineItem}: rows sum to ${actual} cents but the specification says ${expected}`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(`Fixture does not match the published figures:\n  ${problems.join("\n  ")}`);
  }
}

async function main() {
  assertTotals();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  const clear = process.argv.includes("clear");

  try {
    const orgs = await db.select().from(schema.organizations).limit(1);
    const org = orgs[0];
    if (!org) throw new Error("No organisation found — run `npm run db:seed` first");

    const items = await db
      .select()
      .from(schema.lineItems)
      .where(eq(schema.lineItems.orgId, org.id));
    const byName = new Map(items.map((item) => [item.name, item.id]));

    if (clear) {
      const removed = await db
        .delete(schema.expenses)
        .where(and(eq(schema.expenses.orgId, org.id), eq(schema.expenses.month, MONTH)))
        .returning({ id: schema.expenses.id });
      console.log(`Removed ${removed.length} fixture expenses for ${MONTH}.`);
      return;
    }

    const existing = await db
      .select({ id: schema.expenses.id })
      .from(schema.expenses)
      .where(and(eq(schema.expenses.orgId, org.id), eq(schema.expenses.month, MONTH)));
    if (existing.length > 0) {
      console.log(`${MONTH} already has ${existing.length} expenses — nothing to do.`);
      return;
    }

    let sortOrder = 0;
    let day = 2;
    const values: (typeof schema.expenses.$inferInsert)[] = [];

    for (const group of FIXTURE) {
      const lineItemId = byName.get(group.lineItem);
      if (!lineItemId) {
        console.warn(`Skipping unknown line item "${group.lineItem}"`);
        continue;
      }
      for (const [name, description, cents] of group.rows) {
        values.push({
          orgId: org.id,
          lineItemId,
          month: MONTH,
          date: `${MONTH}-${String(day).padStart(2, "0")}`,
          name,
          description,
          paymentSource: SOURCE,
          subtotalCents: cents,
          sortOrder: sortOrder++,
        });
        day = (day % 27) + 1;
      }
    }

    await db.insert(schema.expenses).values(values);

    const vendorRows = values.map((value) => ({
      orgId: org.id,
      name: value.name!,
      defaultLineItemId: value.lineItemId!,
      defaultDescription: value.description ?? "",
    }));
    await db.insert(schema.vendorDefaults).values(vendorRows).onConflictDoNothing();

    await db
      .update(schema.organizations)
      .set({ activeMonth: MONTH })
      .where(eq(schema.organizations.id, org.id));

    console.log(`Inserted ${values.length} expenses for ${MONTH} and set it as the active month.`);
    console.log("Note: none carry documents yet, so the documentation gate blocks downloads.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
