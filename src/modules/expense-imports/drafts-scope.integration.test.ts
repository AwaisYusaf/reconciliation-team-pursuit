/**
 * The drafts reminders on the dashboard, the Month-End Packet page and the monthly summary
 * (usability #64, #65) all count `loadMonthDrafts` for one scope. These pin that scope against a
 * real database: the header's source (or every source on All), the header's month, and the
 * organization, so August's drafts never show in September's notice and another source's never
 * in this one's (E11, E13). `waitingDraftTotals` then groups the All read per source.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("loadMonthDrafts keeps to the source and month asked (E11, E13)", async () => {
  const { db } = await import("@/src/db");
  const { expenseDrafts, expenseImports, fundingSources, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");
  const { waitingDraftTotals } = await import("@/src/domain/draft-rules");
  const { loadMonthDrafts } = await import("./queries");

  const MONTH = "2098-05";
  const EARLIER = "2098-04";

  let orgId: string;
  let otherOrgId: string;
  let sourceA: string;
  let sourceB: string;

  async function importFor(org: string, source: string): Promise<string> {
    const [row] = await db
      .insert(expenseImports)
      .values({
        orgId: org,
        fundingSourceId: source,
        month: MONTH,
        s3Key: `test/${uuidv7()}.pdf`,
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        pageCount: 1,
        sha256: uuidv7().replace(/-/g, "").padEnd(64, "0"),
      })
      .returning({ id: expenseImports.id });
    return row.id;
  }

  async function draft(org: string, source: string, importId: string, month: string, name: string, cents: number) {
    await db.insert(expenseDrafts).values({
      importId,
      orgId: org,
      fundingSourceId: source,
      month,
      date: `${month}-10`,
      name,
      paymentSource: "Operating account",
      subtotalCents: cents,
    });
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Drafts Scope Org", activeMonth: MONTH });
    orgId = org.orgId;
    sourceA = org.fundingSourceId;
    const [second] = await db
      .insert(fundingSources)
      .values({ orgId, name: "Source 2", type: "grant", sortOrder: 1, ...ORIGINAL_RULES })
      .returning({ id: fundingSources.id });
    sourceB = second.id;

    const other = await createTestOrg({ name: "Drafts Scope Other Org", activeMonth: MONTH });
    otherOrgId = other.orgId;

    const importA = await importFor(orgId, sourceA);
    const importB = await importFor(orgId, sourceB);
    const importOther = await importFor(otherOrgId, other.fundingSourceId);

    await draft(orgId, sourceA, importA, MONTH, "A this month 1", 5000);
    await draft(orgId, sourceA, importA, MONTH, "A this month 2", 2500);
    await draft(orgId, sourceB, importB, MONTH, "B this month", 12000);
    await draft(orgId, sourceA, importA, EARLIER, "A last month", 99900);
    await draft(otherOrgId, other.fundingSourceId, importOther, MONTH, "Other org", 7700);
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      if (id) await db.delete(organizations).where(eq(organizations.id, id));
    }
  });

  it("one source: only that source's drafts, only this month", async () => {
    const rows = await loadMonthDrafts(orgId, sourceA, MONTH);
    expect(rows.map((row) => row.name).sort()).toEqual(["A this month 1", "A this month 2"]);
    expect(waitingDraftTotals(rows).get(sourceA)).toEqual({ count: 2, totalCents: 7500 });
    expect(waitingDraftTotals(rows).get(sourceB)).toBeUndefined();
  });

  it("All: every source's drafts for this month, never last month's or another org's, grouped per source", async () => {
    const rows = await loadMonthDrafts(orgId, null, MONTH);
    expect(rows.map((row) => row.name).sort()).toEqual(["A this month 1", "A this month 2", "B this month"]);
    const totals = waitingDraftTotals(rows);
    expect(totals.get(sourceA)).toEqual({ count: 2, totalCents: 7500 });
    expect(totals.get(sourceB)).toEqual({ count: 1, totalCents: 12000 });
    expect(totals.size).toBe(2);
  });

  it("another month is its own count", async () => {
    const rows = await loadMonthDrafts(orgId, sourceA, EARLIER);
    expect(rows.map((row) => row.name)).toEqual(["A last month"]);
  });
});
