/**
 * Phase 0 fixes in the Settings actions, against a real database:
 * - B3: a vendor's default line item must be the organisation's own.
 * - B4: two people deactivating the last two payment sources at once leave one active.
 * - B6: two saves of the same label or vendor name at once give one success and one friendly
 *   refusal, never an unhandled unique-violation error.
 *
 * Each race is forced, not hoped for: `holdOpen` keeps the other person's change uncommitted in
 * a second connection while the action runs, so the action always meets it mid-way. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => {
  const session = vi.fn();
  return { actionSession: session, actionSessionAnyPlan: session, requireAdmin: session };
});

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("settings actions under concurrency (integration, Phase 0)", async () => {
  const { db } = await import("@/src/db");
  const { lineItems, organizations, paymentSources, supportingDocTypes, vendorDefaults } = await import(
    "@/src/db/schema"
  );
  const { createTestOrg } = await import("@/src/db/test-org");
  const { lockOrg } = await import("@/src/db/org-lock");
  const { holdOpen } = await import("@/src/db/hold-open.test-helper");
  const { actionSession } = await import("@/src/lib/action-session");
  const { saveLabelAction, saveVendorAction, setLabelActiveAction } = await import("./actions");

  const session = vi.mocked(actionSession);
  const orgIds: string[] = [];
  let orgId: string;
  let ownLineItem: string;
  let otherOrgLineItem: string;

  function asOrg(id: string) {
    session.mockResolvedValue({
      orgId: id,
      userId: "u",
      email: "e@example.com",
      role: "admin",
      orgName: "Org",
      docName: "Doc",
      activeMonth: "2026-02",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    });
  }

  async function lineItemIn(org: { orgId: string; fundingSourceId: string }, name: string) {
    const [row] = await db
      .insert(lineItems)
      .values({ orgId: org.orgId, fundingSourceId: org.fundingSourceId, name, scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    return row.id;
  }

  async function vendor(name: string) {
    const [row] = await db
      .insert(vendorDefaults)
      .values({ orgId, name, defaultDescription: "" })
      .returning({ id: vendorDefaults.id });
    return row.id;
  }

  const vendorInput = (id: string, overrides: Partial<Parameters<typeof saveVendorAction>[0]> = {}) => ({
    id,
    name: "Office Depot",
    defaultLineItemId: null,
    defaultDescription: "",
    defaultPaymentSource: null,
    defaultSubtotal: "",
    defaultTax: "",
    defaultFees: "",
    ...overrides,
  });

  beforeAll(async () => {
    const org = await createTestOrg({ name: `Phase 0 settings ${Date.now()}` });
    const other = await createTestOrg({ name: `Phase 0 settings other ${Date.now()}` });
    orgIds.push(org.orgId, other.orgId);
    orgId = org.orgId;
    ownLineItem = await lineItemIn(org, "Supplies");
    otherOrgLineItem = await lineItemIn(other, "Their Supplies");
  });

  afterAll(async () => {
    for (const id of orgIds) await db.delete(organizations).where(eq(organizations.id, id));
  });

  beforeEach(() => asOrg(orgId));

  describe("B3: a vendor's default line item", () => {
    it("is refused when it belongs to another organisation, and nothing is stored", async () => {
      const id = await vendor(`B3 foreign ${Date.now()}`);
      const result = await saveVendorAction(vendorInput(id, { name: "B3 foreign", defaultLineItemId: otherOrgLineItem }));
      expect(result).toEqual({ ok: false, error: "Choose a line item." });
      const [row] = await db.select().from(vendorDefaults).where(eq(vendorDefaults.id, id));
      expect(row.defaultLineItemId).toBeNull();
    });

    it("is refused, not thrown, when it is not an id at all", async () => {
      const id = await vendor(`B3 malformed ${Date.now()}`);
      await expect(saveVendorAction(vendorInput(id, { name: "B3 malformed", defaultLineItemId: "not-a-uuid" }))).resolves.toEqual({
        ok: false,
        error: "Choose a line item.",
      });
    });

    it("is saved when it is the organisation's own, and blank means none", async () => {
      const id = await vendor(`B3 own ${Date.now()}`);
      expect(await saveVendorAction(vendorInput(id, { name: "B3 own", defaultLineItemId: ownLineItem }))).toEqual({
        ok: true,
        data: undefined,
      });
      expect((await db.select().from(vendorDefaults).where(eq(vendorDefaults.id, id)))[0].defaultLineItemId).toBe(ownLineItem);

      expect((await saveVendorAction(vendorInput(id, { name: "B3 own", defaultLineItemId: "" }))).ok).toBe(true);
      expect((await db.select().from(vendorDefaults).where(eq(vendorDefaults.id, id)))[0].defaultLineItemId).toBeNull();
    });
  });

  it("B4: a deactivation that lands while another is still saving leaves one payment source active", async () => {
    await db.delete(paymentSources).where(eq(paymentSources.orgId, orgId));
    const [a, b] = await db
      .insert(paymentSources)
      .values([
        { orgId, label: "B4 first", sortOrder: 0 },
        { orgId, label: "B4 second", sortOrder: 1 },
      ])
      .returning({ id: paymentSources.id });

    // Someone else is mid-way through turning off `a` (org row locked, not yet committed) when
    // this person turns off `b`. It must wait for them, then see only one left.
    const { result, blocked } = await holdOpen(
      async (tx) => {
        await lockOrg(tx, orgId, { id: organizations.id });
        await tx.update(paymentSources).set({ active: false }).where(eq(paymentSources.id, a.id));
      },
      () => setLabelActiveAction({ kind: "paymentSource", id: b.id, active: false }),
    );

    expect(blocked).toBe(true); // it waited for the other deactivation, so it saw its result
    expect(result).toEqual({ ok: false, error: "Keep at least one payment source active." });
    const active = await db
      .select({ id: paymentSources.id })
      .from(paymentSources)
      .where(and(eq(paymentSources.orgId, orgId), eq(paymentSources.active, true)));
    expect(active).toEqual([{ id: b.id }]);
  });

  it("refuses a switch value that is not true or false, and a list kind that does not exist (PR #25)", async () => {
    await db.delete(paymentSources).where(eq(paymentSources.orgId, orgId));
    const [only] = await db
      .insert(paymentSources)
      .values({ orgId, label: "Only one", sortOrder: 0 })
      .returning({ id: paymentSources.id });

    // `"false"` used to skip the last-one check and still be stored as false.
    const asString = await setLabelActiveAction({ kind: "paymentSource", id: only.id, active: "false" as never });
    expect(asString).toEqual({ ok: false, error: "That is not a valid value." });
    const bogusKind = await setLabelActiveAction({ kind: "vendor" as never, id: only.id, active: false });
    expect(bogusKind).toEqual({ ok: false, error: "That is not a valid value." });
    expect(await saveLabelAction({ kind: "vendor" as never, label: "X" })).toEqual({
      ok: false,
      error: "That is not a valid value.",
    });

    const [row] = await db.select({ active: paymentSources.active }).from(paymentSources).where(eq(paymentSources.id, only.id));
    expect(row.active).toBe(true);
  });

  describe("B6: the same name saved while another save of it is still in flight", () => {
    it("labels: refused with the friendly message, not an unhandled error", async () => {
      const label = `B6 label ${Date.now()}`;
      const { result, blocked } = await holdOpen(
        (tx) => tx.insert(supportingDocTypes).values({ orgId, label, sortOrder: 99 }),
        () => saveLabelAction({ kind: "supportingDocType", label }),
      );
      expect(blocked).toBe(true); // reached the unique index, not the friendly check
      expect(result).toEqual({ ok: false, error: "That document type already exists." });
    });

    it("vendors: a rename to a name another rename is taking is refused with the friendly message", async () => {
      const stamp = Date.now();
      const [first, second] = [await vendor(`B6 a ${stamp}`), await vendor(`B6 b ${stamp}`)];
      const target = `B6 same ${stamp}`;
      const { result, blocked } = await holdOpen(
        (tx) => tx.update(vendorDefaults).set({ name: target }).where(eq(vendorDefaults.id, first)),
        () => saveVendorAction(vendorInput(second, { name: target })),
      );
      expect(blocked).toBe(true);
      expect(result).toEqual({ ok: false, error: "A vendor with that name already exists." });
    });
  });
});
