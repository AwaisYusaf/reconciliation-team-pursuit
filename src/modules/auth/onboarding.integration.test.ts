/**
 * Onboarding, funding first (m00, D-134; usability #4 to #16, #20, #22), against a real database,
 * through the real actions, pages and the billing return route:
 * - Step 1 (`saveOnboardingFundingAction`): funding name and total required, dates optional with
 *   the end on or after the start, every field error at once; saving renames sign-up's "Source 1".
 * - Step 2 (`saveOnboardingLineItemsAction`): all or nothing. A name with no amount is an error,
 *   never dropped (#8); every row's error at once; rows over the total save nothing (R9.6); a
 *   success saves the rows, seeds the lists (D-19) and marks the org onboarded.
 * - The pages: resuming lands on the right step with saved values (amounts with commas, #13), the
 *   payment note shows only after checkout (#9), the old contract URL redirects.
 *
 * `redirect()` is a throwing sentinel; the session helpers are mocked (the paid-access guard in
 * front of all of this is proven with a real session in `no-free-use.integration.test.ts`).
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));
vi.mock("@/src/lib/page-session", () => ({ pageSession: vi.fn() }));
vi.mock("@/src/services/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/src/modules/billing/sync", () => ({ refreshOrgBilling: vi.fn(async () => {}) }));

config({ path: ".env.local", quiet: true });

import type { ReactElement, ReactNode } from "react";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("onboarding, funding first (integration, m00, D-134)", async () => {
  const { db } = await import("@/src/db");
  const { fundingSources, lineItems, organizations, paymentSources, supportingDocTypes } = await import(
    "@/src/db/schema"
  );
  const { createTestOrg } = await import("@/src/db/test-org");
  const { holdOpen } = await import("@/src/db/hold-open.test-helper");
  const { UI } = await import("@/src/domain/strings");
  const { actionSession } = await import("@/src/lib/action-session");
  const { pageSession } = await import("@/src/lib/page-session");
  const { getSession } = await import("@/src/services/auth/session");
  const { saveOnboardingFundingAction, saveOnboardingLineItemsAction } = await import("./actions");
  const FundingPage = (await import("@/app/(auth)/onboarding/funding/page")).default;
  const LineItemsPage = (await import("@/app/(auth)/onboarding/line-items/page")).default;
  const ContractPage = (await import("@/app/(auth)/onboarding/contract/page")).default;
  const { OnboardingSignOut } = await import("@/app/(auth)/onboarding/sign-out");
  const { GET: billingReturn } = await import("@/app/r/billing/return/route");

  const IDLE = { ok: false as const, error: "" };
  const ALREADY_SET_UP = "Your organization is already set up.";
  const createdOrgIds: string[] = [];

  afterAll(async () => {
    for (const id of createdOrgIds) await db.delete(organizations).where(eq(organizations.id, id));
  });

  /** A signed-up, not yet onboarded org: "Source 1" with no contract value, like sign-up leaves it. */
  async function newOrg({ contractValueCents = 0, onboarded = false } = {}) {
    const { orgId, fundingSourceId } = await createTestOrg({ name: `Onboarding ${Date.now()}` });
    createdOrgIds.push(orgId);
    if (contractValueCents > 0) {
      await db.update(fundingSources).set({ contractValueCents }).where(eq(fundingSources.id, fundingSourceId));
    }
    if (onboarded) await db.update(organizations).set({ onboardedAt: new Date() }).where(eq(organizations.id, orgId));
    signIn(orgId, onboarded);
    return { orgId, fundingSourceId };
  }

  /** Both session helpers answer for this org; `onboarded` is what the session says. */
  function signIn(orgId: string, onboarded: boolean) {
    const context = {
      orgId,
      userId: "u",
      email: "dana@example.org",
      role: "admin" as const,
      orgName: "Org",
      docName: "Doc",
      activeMonth: "2026-09",
      activeFundingSourceId: null,
      onboarded,
      welcomeDismissed: false,
      plan: "reconciliation" as const,
    };
    vi.mocked(actionSession).mockResolvedValue(context);
    vi.mocked(pageSession).mockResolvedValue(context);
    vi.mocked(getSession).mockResolvedValue(context);
  }

  function fundingForm(fields: Partial<Record<"fundingName" | "contractValue" | "contractStart" | "contractEnd" | "fiduciaryName", string>>) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  }

  function rowsForm(rows: Array<[string, string]>) {
    const form = new FormData();
    for (const [name, amount] of rows) {
      form.append("lineItemName", name);
      form.append("lineItemBudget", amount);
    }
    return form;
  }

  async function sourceRow(id: string) {
    const [row] = await db.select().from(fundingSources).where(eq(fundingSources.id, id));
    return row;
  }

  async function savedRows(fundingSourceId: string) {
    return db
      .select({ name: lineItems.name, cents: lineItems.scheduledValueCents, sortOrder: lineItems.sortOrder })
      .from(lineItems)
      .where(eq(lineItems.fundingSourceId, fundingSourceId))
      .orderBy(lineItems.sortOrder);
  }

  async function orgState(orgId: string) {
    const [org] = await db.select({ onboardedAt: organizations.onboardedAt }).from(organizations).where(eq(organizations.id, orgId));
    const payment = await db.select().from(paymentSources).where(eq(paymentSources.orgId, orgId));
    const docTypes = await db.select().from(supportingDocTypes).where(eq(supportingDocTypes.orgId, orgId));
    return { onboarded: org.onboardedAt !== null, paymentSources: payment.length, docTypes: docTypes.length };
  }

  /** Every element in a returned page tree (the pages are server components returning JSX). */
  function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (node === null || typeof node !== "object" || !("props" in node)) return [];
    const element = node as ReactElement<Record<string, unknown>>;
    const nested = Object.values(element.props).flatMap((value) => elements(value as ReactNode));
    return [element, ...nested];
  }

  const propsWith = (tree: ReactNode, key: string) =>
    elements(tree).find((element) => key in element.props)?.props as Record<string, unknown>;

  describe("step 1: the funding (saveOnboardingFundingAction)", () => {
    it("E25: a missing name and total are both reported at once; nothing is written", async () => {
      const { fundingSourceId } = await newOrg();
      expect(await saveOnboardingFundingAction(IDLE, fundingForm({ fundingName: "  ", contractValue: "" }))).toEqual({
        ok: false,
        error: UI.checkHighlightedFields,
        fieldErrors: { fundingName: "Enter a name for this funding.", contractValue: "Enter the total amount." },
      });
      expect((await sourceRow(fundingSourceId)).name).toBe("Source 1");
    });

    it.each(["0", "0.00", "-5", "(5.00)", "abc"])("E26: total %s is refused", async (total) => {
      await newOrg();
      const result = await saveOnboardingFundingAction(IDLE, fundingForm({ fundingName: "Kresge Grant", contractValue: total }));
      expect(result).toEqual({
        ok: false,
        error: UI.checkHighlightedFields,
        fieldErrors: { contractValue: "Enter the total amount." },
      });
    });

    it("E27: invalid dates and an end before the start are refused; the same day is fine", async () => {
      const { fundingSourceId } = await newOrg();
      const base = { fundingName: "Kresge Grant", contractValue: "150,000.00" };
      expect(await saveOnboardingFundingAction(IDLE, fundingForm({ ...base, contractStart: "2026-13-40", contractEnd: "nope" }))).toEqual({
        ok: false,
        error: UI.checkHighlightedFields,
        fieldErrors: { contractStart: "Enter a valid start date.", contractEnd: "Enter a valid end date." },
      });
      expect(
        await saveOnboardingFundingAction(IDLE, fundingForm({ ...base, contractStart: "2026-10-01", contractEnd: "2026-09-30" })),
      ).toEqual({
        ok: false,
        error: UI.checkHighlightedFields,
        fieldErrors: { contractEnd: "The end date is before the start date." },
      });
      expect((await sourceRow(fundingSourceId)).contractValueCents).toBe(0);
      await expect(
        saveOnboardingFundingAction(IDLE, fundingForm({ ...base, contractStart: "2026-10-01", contractEnd: "2026-10-01" })),
      ).rejects.toThrow("NEXT_REDIRECT:/onboarding/line-items");
    });

    it("E28: saves the funding onto the first source, renaming Source 1, then goes to step 2", async () => {
      const { fundingSourceId } = await newOrg();
      await expect(
        saveOnboardingFundingAction(
          IDLE,
          fundingForm({
            fundingName: "  Kresge Grant  ",
            contractValue: "150,000.00",
            contractStart: "2026-10-01",
            contractEnd: "2027-09-30",
            fiduciaryName: " Detroit Crime Commission ",
          }),
        ),
      ).rejects.toThrow(/^NEXT_REDIRECT:\/onboarding\/line-items$/);
      const row = await sourceRow(fundingSourceId);
      expect(row).toMatchObject({
        name: "Kresge Grant",
        contractValueCents: 15_000_000,
        contractStart: "2026-10-01",
        contractEnd: "2027-09-30",
        fiduciaryName: "Detroit Crime Commission",
      });
    });

    it("a name another funding source of the org already has is a field error, not a 500 (the unique index)", async () => {
      const { orgId, fundingSourceId } = await newOrg();
      await db
        .insert(fundingSources)
        .values({ orgId, name: "Other Grant", type: "grant", sortOrder: 1, taxReimbursable: false, feesReimbursable: true });
      expect(await saveOnboardingFundingAction(IDLE, fundingForm({ fundingName: "OTHER grant", contractValue: "100.00" }))).toEqual({
        ok: false,
        error: UI.checkHighlightedFields,
        fieldErrors: { fundingName: "A funding source with that name already exists." },
      });
      expect(await sourceRow(fundingSourceId)).toMatchObject({ name: "Source 1", contractValueCents: 0 });
    });

    it("E29b: waits for another tab's Finish being saved, then refuses; the funding is untouched", async () => {
      const { orgId, fundingSourceId } = await newOrg();
      const { result, blocked } = await holdOpen(
        (tx) => tx.update(organizations).set({ onboardedAt: new Date() }).where(eq(organizations.id, orgId)),
        () => saveOnboardingFundingAction(IDLE, fundingForm({ fundingName: "Back tab", contractValue: "1.00" })),
      );
      expect(blocked).toBe(true);
      expect(result).toEqual({ ok: false, error: ALREADY_SET_UP });
      expect(await sourceRow(fundingSourceId)).toMatchObject({ name: "Source 1", contractValueCents: 0 });
    });

    it("E29: refused once the org is set up, by the session and by the row itself (stale tab)", async () => {
      const { fundingSourceId } = await newOrg({ onboarded: true });
      const valid = fundingForm({ fundingName: "Replayed", contractValue: "1.00" });
      expect(await saveOnboardingFundingAction(IDLE, valid)).toEqual({ ok: false, error: ALREADY_SET_UP });
      // The session still says "not onboarded" (another tab finished a moment ago): the row decides.
      const second = await newOrg({ onboarded: true });
      signIn(second.orgId, false);
      expect(await saveOnboardingFundingAction(IDLE, valid)).toEqual({ ok: false, error: ALREADY_SET_UP });
      expect((await sourceRow(fundingSourceId)).name).toBe("Source 1");
      expect((await sourceRow(second.fundingSourceId)).name).toBe("Source 1");
    });

    it("E29c: the session alone refuses both steps (the row isn't marked set up yet)", async () => {
      const { orgId, fundingSourceId } = await newOrg({ contractValueCents: 15_000_000 });
      signIn(orgId, true);
      expect(await saveOnboardingFundingAction(IDLE, fundingForm({ fundingName: "Replayed", contractValue: "1.00" }))).toEqual({
        ok: false,
        error: ALREADY_SET_UP,
      });
      expect(await saveOnboardingLineItemsAction(IDLE, rowsForm([["Replayed", "1.00"]]))).toEqual({ ok: false, error: ALREADY_SET_UP });
      expect(await sourceRow(fundingSourceId)).toMatchObject({ name: "Source 1", contractValueCents: 15_000_000 });
      expect(await savedRows(fundingSourceId)).toEqual([]);
      expect((await orgState(orgId)).onboarded).toBe(false);
    });
  });

  describe("step 2: the line items and finish (saveOnboardingLineItemsAction)", () => {
    it("E30/E42: before the funding is saved (an old step-1 tab), nothing is saved", async () => {
      const { orgId, fundingSourceId } = await newOrg();
      expect(await saveOnboardingLineItemsAction(IDLE, rowsForm([["Salary", "1,000.00"]]))).toEqual({
        ok: false,
        error: UI.onboardingFundingFirst,
      });
      expect(await savedRows(fundingSourceId)).toEqual([]);
      expect((await orgState(orgId)).onboarded).toBe(false);
    });

    it("E42: an old tab's rows are not judged before the funding exists: 'set up your funding first', not row errors", async () => {
      await newOrg();
      expect(await saveOnboardingLineItemsAction(IDLE, rowsForm([["Salary", ""]]))).toEqual({
        ok: false,
        error: UI.onboardingFundingFirst,
      });
    });

    it("E30b: the total is re-read under the lock: cleared while this waited, nothing is saved", async () => {
      const { orgId, fundingSourceId } = await newOrg({ contractValueCents: 15_000_000 });
      const { result, blocked } = await holdOpen(
        (tx) => tx.update(fundingSources).set({ contractValueCents: 0 }).where(eq(fundingSources.id, fundingSourceId)),
        () => saveOnboardingLineItemsAction(IDLE, rowsForm([["Salary", "1,000.00"]])),
      );
      expect(blocked).toBe(true);
      expect(result).toEqual({ ok: false, error: UI.onboardingFundingFirst });
      expect(await savedRows(fundingSourceId)).toEqual([]);
      expect((await orgState(orgId)).onboarded).toBe(false);
    });

    it("E37b: the rows are judged against the total read under the lock (lowered by a Back tab meanwhile)", async () => {
      const { orgId, fundingSourceId } = await newOrg({ contractValueCents: 15_000_000 });
      const { result, blocked } = await holdOpen(
        (tx) => tx.update(fundingSources).set({ contractValueCents: 10_000_000 }).where(eq(fundingSources.id, fundingSourceId)),
        () => saveOnboardingLineItemsAction(IDLE, rowsForm([["Salary", "120,000.00"]])),
      );
      expect(blocked).toBe(true);
      expect(result).toEqual({ ok: false, error: UI.onboardingOverTotal("$120,000.00", "$100,000.00") });
      expect(await savedRows(fundingSourceId)).toEqual([]);
      expect((await orgState(orgId)).onboarded).toBe(false);
    });

    it("E43b: a second Finish waits for the first being saved, then refuses; the finished org's rows are untouched", async () => {
      const { orgId, fundingSourceId } = await newOrg({ contractValueCents: 15_000_000 });
      await db.insert(lineItems).values({ orgId, fundingSourceId, name: "Live", scheduledValueCents: 100, sortOrder: 0 });
      const { result, blocked } = await holdOpen(
        (tx) => tx.update(organizations).set({ onboardedAt: new Date() }).where(eq(organizations.id, orgId)),
        () => saveOnboardingLineItemsAction(IDLE, rowsForm([["Replayed", "1.00"]])),
      );
      expect(blocked).toBe(true);
      expect(result).toEqual({ ok: false, error: ALREADY_SET_UP });
      expect((await savedRows(fundingSourceId)).map((row) => row.name)).toEqual(["Live"]);
    });

    it("E31 (#8): a name with no amount is an error asking for it, never dropped; nothing is saved", async () => {
      const { orgId, fundingSourceId } = await newOrg({ contractValueCents: 15_000_000 });
      expect(await saveOnboardingLineItemsAction(IDLE, rowsForm([["Salary", "100,000.00"], ["Analytical Support", ""]]))).toEqual({
        ok: false,
        error: UI.onboardingCheckRows,
        fieldErrors: { "row-1-amount": UI.onboardingRowNeedsAmount("Analytical Support") },
      });
      expect(await savedRows(fundingSourceId)).toEqual([]);
      expect(await orgState(orgId)).toEqual({ onboarded: false, paymentSources: 0, docTypes: 0 });
    });

    it("E32/E34/E36/E41: every row's error comes back at once, one per row, keyed by its position", async () => {
      await newOrg({ contractValueCents: 15_000_000 });
      const result = await saveOnboardingLineItemsAction(
        IDLE,
        rowsForm([
          ["Salary", ""], // needs an amount
          ["salary", "5.00"], // a repeat (any case) of a named row, even one with its own error
          ["", "500.00"], // an amount with no name
          ["Travel", "-5"], // negative
          ["Rent", "abc"], // unreadable
          ["", ""], // blank: ignored
          ["Supplies", "10.00"], // fine
        ]),
      );
      expect(result).toEqual({
        ok: false,
        error: UI.onboardingCheckRows,
        fieldErrors: {
          "row-0-amount": UI.onboardingRowNeedsAmount("Salary"),
          "row-1-name": UI.lineItemDuplicate,
          "row-2-name": UI.onboardingRowNeedsName,
          "row-3-amount": UI.onboardingRowNegative("Travel"),
          "row-4-amount": UI.onboardingRowNeedsAmount("Rent"),
        },
      });
    });

    it("E35: a repeated name (any case) is an error on the later row", async () => {
      await newOrg({ contractValueCents: 15_000_000 });
      expect(await saveOnboardingLineItemsAction(IDLE, rowsForm([["Salary", "1.00"], ["SALARY", "2.00"]]))).toEqual({
        ok: false,
        error: UI.onboardingCheckRows,
        fieldErrors: { "row-1-name": UI.lineItemDuplicate },
      });
    });

    it("E40: a name pair JS keeps apart but the database index folds together gets the friendly message", async (ctx) => {
      // JS lowers "İ" to "i" + U+0307; Postgres under a Unicode-aware collation lowers it to "i".
      const { rows } = await db.execute(sql`select lower('İstanbul trip') = lower('istanbul trip') as clash`);
      if (!(rows[0] as { clash: boolean }).clash) ctx.skip(); // this database's collation doesn't fold them
      const { orgId, fundingSourceId } = await newOrg({ contractValueCents: 15_000_000 });
      expect("İstanbul trip".toLowerCase()).not.toBe("istanbul trip");
      expect(await saveOnboardingLineItemsAction(IDLE, rowsForm([["İstanbul trip", "1.00"], ["istanbul trip", "2.00"]]))).toEqual({
        ok: false,
        error: UI.lineItemDuplicate,
      });
      expect(await savedRows(fundingSourceId)).toEqual([]);
      expect(await orgState(orgId)).toEqual({ onboarded: false, paymentSources: 0, docTypes: 0 });
    });

    it("E33: only blank rows asks for at least one line item", async () => {
      await newOrg({ contractValueCents: 15_000_000 });
      expect(await saveOnboardingLineItemsAction(IDLE, rowsForm([["", ""], ["  ", " "]]))).toEqual({
        ok: false,
        error: UI.onboardingNoLineItems,
      });
    });

    it("E37 (#16): rows over the total are refused and NOTHING is saved (no rows, no lists, not onboarded)", async () => {
      const { orgId, fundingSourceId } = await newOrg({ contractValueCents: 15_000_000 });
      expect(await saveOnboardingLineItemsAction(IDLE, rowsForm([["Salary", "120,000.00"], ["Programs", "80,000.00"]]))).toEqual({
        ok: false,
        error: UI.onboardingOverTotal("$200,000.00", "$150,000.00"),
      });
      expect(await savedRows(fundingSourceId)).toEqual([]);
      expect(await orgState(orgId)).toEqual({ onboarded: false, paymentSources: 0, docTypes: 0 });
    });

    it("E37c: one cent over the total is refused and nothing is saved", async () => {
      const { orgId, fundingSourceId } = await newOrg({ contractValueCents: 15_000_000 });
      expect(await saveOnboardingLineItemsAction(IDLE, rowsForm([["Salary", "150,000.01"]]))).toEqual({
        ok: false,
        error: UI.onboardingOverTotal("$150,000.01", "$150,000.00"),
      });
      expect(await savedRows(fundingSourceId)).toEqual([]);
      expect((await orgState(orgId)).onboarded).toBe(false);
    });

    it("E37d: strict even when rows from the previous flow were further over (not the in-app 'further over' rule)", async () => {
      const { orgId, fundingSourceId } = await newOrg({ contractValueCents: 15_000_000 });
      await db.insert(lineItems).values({ orgId, fundingSourceId, name: "Old", scheduledValueCents: 20_000_000, sortOrder: 0 });
      expect(await saveOnboardingLineItemsAction(IDLE, rowsForm([["Salary", "160,000.00"]]))).toEqual({
        ok: false,
        error: UI.onboardingOverTotal("$160,000.00", "$150,000.00"),
      });
      expect((await savedRows(fundingSourceId)).map((row) => row.name)).toEqual(["Old"]);
      expect((await orgState(orgId)).onboarded).toBe(false);
    });

    it("E38: rows adding up to exactly the total finish: saved in order, lists seeded, onboarded", async () => {
      const { orgId, fundingSourceId } = await newOrg({ contractValueCents: 15_000_000 });
      await expect(
        saveOnboardingLineItemsAction(IDLE, rowsForm([["Salary", "120,000.00"], ["", ""], ["Programs", "30,000.00"], ["Zero", "0"]])),
      ).rejects.toThrow(/^NEXT_REDIRECT:\/r$/);
      expect(await savedRows(fundingSourceId)).toEqual([
        { name: "Salary", cents: 12_000_000, sortOrder: 0 },
        { name: "Programs", cents: 3_000_000, sortOrder: 1 },
        { name: "Zero", cents: 0, sortOrder: 2 },
      ]);
      const state = await orgState(orgId);
      expect(state.onboarded).toBe(true);
      expect(state.paymentSources).toBeGreaterThan(0);
      expect(state.docTypes).toBeGreaterThan(0);
    });

    it("E39: replaces rows saved by the previous flow", async () => {
      const { orgId, fundingSourceId } = await newOrg({ contractValueCents: 15_000_000 });
      await db.insert(lineItems).values([
        { orgId, fundingSourceId, name: "Old A", scheduledValueCents: 100, sortOrder: 0 },
        { orgId, fundingSourceId, name: "Old B", scheduledValueCents: 200, sortOrder: 1 },
      ]);
      await expect(saveOnboardingLineItemsAction(IDLE, rowsForm([["New C", "5.00"]]))).rejects.toThrow("NEXT_REDIRECT:/r");
      expect((await savedRows(fundingSourceId)).map((row) => row.name)).toEqual(["New C"]);
    });

    it("E43: refused once the org is set up (session, or the row after another tab finished); rows untouched", async () => {
      const { orgId, fundingSourceId } = await newOrg({ contractValueCents: 15_000_000, onboarded: true });
      await db.insert(lineItems).values({ orgId, fundingSourceId, name: "Live", scheduledValueCents: 100, sortOrder: 0 });
      const form = rowsForm([["Replayed", "1.00"]]);
      expect(await saveOnboardingLineItemsAction(IDLE, form)).toEqual({ ok: false, error: ALREADY_SET_UP });
      signIn(orgId, false);
      expect(await saveOnboardingLineItemsAction(IDLE, form)).toEqual({ ok: false, error: ALREADY_SET_UP });
      expect((await savedRows(fundingSourceId)).map((row) => row.name)).toEqual(["Live"]);
    });
  });

  describe("the pages: resuming and the entry redirects", () => {
    it("E44: the line items page sends an org without saved funding to step 1", async () => {
      await newOrg();
      await expect(LineItemsPage()).rejects.toThrow(/^NEXT_REDIRECT:\/onboarding\/funding$/);
    });

    it("E45 (#13): with the funding saved, saved rows come back with commas; else the six starter names", async () => {
      const { orgId, fundingSourceId } = await newOrg({ contractValueCents: 15_000_000 });
      const starter = propsWith(await LineItemsPage(), "initialRows");
      expect(starter.totalCents).toBe(15_000_000);
      expect(starter.initialRows).toHaveLength(6);
      expect((starter.initialRows as Array<{ budget: string }>).every((row) => row.budget === "")).toBe(true);

      await db.insert(lineItems).values({ orgId, fundingSourceId, name: "Salary", scheduledValueCents: 12_000_000, sortOrder: 0 });
      // Another source's line items are not this step's rows.
      const [other] = await db
        .insert(fundingSources)
        .values({ orgId, name: "Other", type: "grant", sortOrder: 5, taxReimbursable: false, feesReimbursable: true })
        .returning({ id: fundingSources.id });
      await db.insert(lineItems).values({ orgId, fundingSourceId: other.id, name: "Not mine", scheduledValueCents: 1, sortOrder: 0 });
      const resumed = propsWith(await LineItemsPage(), "initialRows");
      expect(resumed.initialRows).toEqual([{ name: "Salary", budget: "120,000.00" }]);
    });

    it("E46: the funding page before step 1 starts blank (not 'Source 1' and $0.00)", async () => {
      await newOrg();
      const form = propsWith(await FundingPage({ searchParams: Promise.resolve({}) }), "initial");
      expect(form.initial).toEqual({ name: "", total: "", start: "", end: "", fiduciary: "" });
      expect(form.rulesLine).toBe(UI.onboardingRules(false, true)); // test-org's ORIGINAL_RULES
    });

    it("E47: the funding page after step 1 shows the saved values, the total with commas", async () => {
      const { fundingSourceId } = await newOrg();
      await db
        .update(fundingSources)
        .set({ name: "Kresge Grant", contractValueCents: 15_000_000, contractStart: "2026-10-01", fiduciaryName: "DCC" })
        .where(eq(fundingSources.id, fundingSourceId));
      const form = propsWith(await FundingPage({ searchParams: Promise.resolve({}) }), "initial");
      expect(form.initial).toEqual({ name: "Kresge Grant", total: "150,000.00", start: "2026-10-01", end: "", fiduciary: "DCC" });
    });

    it("#9: the payment note shows only with paid=1", async () => {
      await newOrg();
      const note = (tree: ReactNode) => elements(tree).some((element) => element.props.children === UI.onboardingPaymentReceived);
      expect(note(await FundingPage({ searchParams: Promise.resolve({ paid: "1" }) }))).toBe(true);
      expect(note(await FundingPage({ searchParams: Promise.resolve({}) }))).toBe(false);
      expect(note(await FundingPage({ searchParams: Promise.resolve({ paid: "yes" }) }))).toBe(false);
      expect(note(await FundingPage({ searchParams: Promise.resolve({ paid: "0" }) }))).toBe(false);
      expect(note(await FundingPage({ searchParams: Promise.resolve({ paid: ["1"] }) }))).toBe(false);
    });

    it("#12 (AC11): both steps show 'Signed in as' with this person's email, and Sign out", async () => {
      await newOrg({ contractValueCents: 15_000_000 });
      const footerEmail = (tree: ReactNode) =>
        elements(tree).find((element) => element.type === OnboardingSignOut)?.props.email;
      expect(footerEmail(await FundingPage({ searchParams: Promise.resolve({}) }))).toBe("dana@example.org");
      expect(footerEmail(await LineItemsPage())).toBe("dana@example.org");
      const texts = (node: ReactNode): string[] =>
        typeof node === "string"
          ? [node]
          : elements(node).flatMap((element) => {
              const children = element.props.children;
              return (Array.isArray(children) ? children : [children]).filter((c): c is string => typeof c === "string");
            });
      const rendered = texts(OnboardingSignOut({ email: "dana@example.org" })).join("");
      expect(rendered).toContain("Signed in as dana@example.org.");
      expect(rendered).toContain("Sign out");
    });

    it("an onboarded org is sent to the app from both steps", async () => {
      await newOrg({ contractValueCents: 15_000_000, onboarded: true });
      await expect(FundingPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/^NEXT_REDIRECT:\/r$/);
      await expect(LineItemsPage()).rejects.toThrow(/^NEXT_REDIRECT:\/r$/);
    });

    it("E57: the old /onboarding/contract URL redirects (to step 1, or the app once onboarded)", async () => {
      await newOrg();
      await expect(ContractPage()).rejects.toThrow(/^NEXT_REDIRECT:\/onboarding\/funding$/);
      await newOrg({ onboarded: true });
      await expect(ContractPage()).rejects.toThrow(/^NEXT_REDIRECT:\/r$/);
    });

    it("E48/E49: after checkout, a not-yet-set-up org goes to step 1 with the payment note; a set-up one to Settings", async () => {
      await newOrg();
      await expect(billingReturn()).rejects.toThrow(/^NEXT_REDIRECT:\/onboarding\/funding\?paid=1$/);
      await newOrg({ onboarded: true });
      await expect(billingReturn()).rejects.toThrow(/^NEXT_REDIRECT:\/r\/settings\?section=plan$/);
      vi.mocked(getSession).mockResolvedValue(null);
      await expect(billingReturn()).rejects.toThrow(/^NEXT_REDIRECT:\/login$/);
    });
  });
});
