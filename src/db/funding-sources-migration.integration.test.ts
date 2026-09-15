/**
 * Phase 6 (D-93) migration invariants against the migrated schema.
 *
 * The composite foreign keys are the database backstop for the two rules the app layer also
 * enforces: an expense's line item must belong to the expense's source, and a source id must
 * belong to the row's organisation. These prove the backstop actually fires (Postgres code
 * 23503) even if an app check is ever forgotten, and that deleting an organisation with
 * sources, line items and expenses still succeeds — the `NO ACTION` composite FKs (decision
 * 2.3) must not break the org cascade.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("funding sources migration (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, fundingSources, lineItems, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");

  let orgA: { orgId: string; fundingSourceId: string };
  let orgB: { orgId: string; fundingSourceId: string };
  let lineItemA: string;
  /** A second source in orgA — distinct from orgA's own first source. */
  let sourceA2: string;

  beforeAll(async () => {
    orgA = await createTestOrg({ name: "Migration Org A", docName: "MigA", activeMonth: "2099-01" });
    orgB = await createTestOrg({ name: "Migration Org B", docName: "MigB", activeMonth: "2099-01" });

    const [itemA] = await db
      .insert(lineItems)
      .values({ orgId: orgA.orgId, fundingSourceId: orgA.fundingSourceId, name: "A's item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemA = itemA.id;

    const [source2] = await db
      .insert(fundingSources)
      .values({
        orgId: orgA.orgId,
        name: "A's second source",
        type: "grant",
        sortOrder: 1,
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: fundingSources.id });
    sourceA2 = source2.id;
  });

  afterAll(async () => {
    for (const org of [orgA, orgB]) {
      if (org) await db.delete(organizations).where(eq(organizations.id, org.orgId));
    }
  });

  it("refuses an expense whose line item belongs to a different source (23503)", async () => {
    // A's line item paired with A's OWN second source — same organisation, so the
    // (funding_source_id, org_id) FK passes and only the FK under test,
    // expenses(line_item_id, funding_source_id) → line_items(id, funding_source_id), can fire.
    // Review fix: this previously paired the line item with org B's source instead, so the
    // (funding_source_id, org_id) cross-org FK failed first and the two same-org sources case
    // was never actually exercised.
    const rejection = await db
      .insert(expenses)
      .values({
        orgId: orgA.orgId,
        fundingSourceId: sourceA2,
        lineItemId: lineItemA,
        month: "2099-01",
        date: "2099-01-10",
        name: "Cross-source expense",
        paymentSource: "x",
        subtotalCents: 1000,
        sortOrder: 0,
        referenceSeq: 1,
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    const cause = (rejection as Error & { cause?: { code?: string } }).cause;
    expect(cause?.code).toBe("23503"); // foreign_key_violation
  });

  it("refuses a line item whose source belongs to another organisation (23503)", async () => {
    // A's org paired with B's source — the composite FK
    // line_items(funding_source_id, org_id) → funding_sources(id, org_id) must fire.
    const rejection = await db
      .insert(lineItems)
      .values({ orgId: orgA.orgId, fundingSourceId: orgB.fundingSourceId, name: "Cross-org item", scheduledValueCents: 100_000, sortOrder: 9 })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    const cause = (rejection as Error & { cause?: { code?: string } }).cause;
    expect(cause?.code).toBe("23503"); // foreign_key_violation
  });

  it("deleting an organisation with sources, line items and expenses still succeeds (decision 2.3)", async () => {
    // The composite FKs use ON DELETE NO ACTION, checked at end of statement, so the org
    // cascade to funding_sources and the child tables completes in one statement. RESTRICT
    // would be checked immediately and break this.
    const org = await createTestOrg({ name: "Migration Org C", docName: "MigC", activeMonth: "2099-01" });
    const [item] = await db
      .insert(lineItems)
      .values({ orgId: org.orgId, fundingSourceId: org.fundingSourceId, name: "C's item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    await db.insert(expenses).values({
      orgId: org.orgId,
      fundingSourceId: org.fundingSourceId,
      lineItemId: item.id,
      month: "2099-01",
      date: "2099-01-10",
      name: "C's expense",
      paymentSource: "x",
      subtotalCents: 1000,
      sortOrder: 0,
      referenceSeq: 1,
      taxReimbursable: false,
      feesReimbursable: true,
    });

    await expect(db.delete(organizations).where(eq(organizations.id, org.orgId))).resolves.toBeDefined();

    // Everything under it is gone too.
    const sources = await db.select().from(lineItems).where(eq(lineItems.orgId, org.orgId));
    expect(sources).toHaveLength(0);
  });
});