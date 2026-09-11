/**
 * Per-expense audit trail (admin-only).
 *
 * Drives the real server actions and `loadExpenseAuditHistory` against a real database, in
 * the same style as `expenses-trash.integration.test.ts`: `actionSession()` mocked so the
 * test controls which org/user is "signed in", `next/cache`'s `revalidatePath` stubbed.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// FORBIDDEN's exact wording is stable/public (see src/lib/action-session.ts) — restated here
// since mocking the whole module below shadows the real export.
const FORBIDDEN = "You do not have permission to do that.";
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn(), requireAdmin: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ExpenseAuditActionType } from "@/src/db/schema";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("expense audit events (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenseAuditEvents, expenses, lineItems, organizations, paymentSources, users } =
    await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { claimReferenceSeq } = await import("./references");
  const { actionSession, requireAdmin } = await import("@/src/lib/action-session");
  const {
    createExpenseAction,
    updateExpenseAction,
    deleteExpenseAction,
    restoreExpenseAction,
    permanentlyDeleteExpenseAction,
    loadExpenseHistoryAction,
  } = await import("./actions");
  const { loadOrgAuditHistory } = await import("./queries");

  /** Filters the org-wide audit log down to one expense's events, matching the shape the
   *  old per-expense `loadExpenseAuditHistory` returned, so the assertions below still read
   *  the way they did before D-87 replaced it with the org-wide page. */
  async function historyFor(historyOrgId: string, expenseId: string) {
    const { events } = await loadOrgAuditHistory(historyOrgId, { page: 1 });
    return events.filter((event) => event.expenseId === expenseId);
  }

  const session = vi.mocked(actionSession);
  const adminGate = vi.mocked(requireAdmin);

  let orgId: string;
  let otherOrgId: string;
  let lineItemId: string;
  let lineItemId2: string;
  let otherLineItemId: string;
  let userA: string;
  let userB: string;
  let otherOrgUser: string;

  const MONTH = "2099-01";

  async function insertUser(orgId: string, role: "admin" | "manager" = "admin") {
    const [row] = await db
      .insert(users)
      .values({
        orgId,
        email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role,
      })
      .returning({ id: users.id });
    return row.id;
  }

  function asUser(orgId: string, userId: string, role: "admin" | "manager" = "admin") {
    const context = {
      orgId,
      userId,
      email: "e@example.com",
      role,
      orgName: "Org",
      docName: "Doc",
      activeMonth: MONTH,
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
    };
    session.mockResolvedValue(context);
    // requireAdmin() is a separate export on the same mocked module — actions.ts that call it
    // (loadExpenseHistoryAction) need it wired to the same session, not left undefined.
    adminGate.mockResolvedValue(role === "admin" ? context : { denied: { ok: false, error: FORBIDDEN } });
  }

  let sortCounter = 0;
  async function insertExpense(overrides: { orgId: string; lineItemId: string; month?: string }) {
    const month = overrides.month ?? MONTH;
    // The expense's source is its line item's source (Phase 6, D-93) — resolved here so the
    // ~20 call sites stay unchanged; this is setup, not an assertion.
    const [item] = await db
      .select({ fundingSourceId: lineItems.fundingSourceId })
      .from(lineItems)
      .where(eq(lineItems.id, overrides.lineItemId));
    const [row] = await db
      .insert(expenses)
      .values({
        orgId: overrides.orgId,
        fundingSourceId: item.fundingSourceId,
        lineItemId: overrides.lineItemId,
        month,
        date: `${month}-10`,
        name: "Test expense",
        paymentSource: "Cash",
        subtotalCents: 1000,
        sortOrder: sortCounter++,
        referenceSeq: await claimReferenceSeq(overrides.orgId, item.fundingSourceId, month),
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: expenses.id });
    return row.id;
  }

  function baseInput(overrides: Partial<Parameters<typeof createExpenseAction>[0]> = {}) {
    return {
      name: "An expense",
      lineItemId,
      paymentSource: "Cash",
      taxReimbursable: false,
      feesReimbursable: true,
      month: MONTH,
      date: `${MONTH}-15`,
      description: "",
      subtotal: "10.00",
      tax: "0",
      fees: "0",
      note: "",
      narrative: "narrative",
      noReceipt: false,
      noReceiptReason: "",
      ...overrides,
    };
  }

  async function eventsFor(expenseId: string) {
    return db.select().from(expenseAuditEvents).where(eq(expenseAuditEvents.expenseId, expenseId));
  }

  async function allEventsForOrg(orgId: string) {
    return db.select().from(expenseAuditEvents).where(eq(expenseAuditEvents.orgId, orgId));
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Audit Org", docName: "Audit", activeMonth: MONTH });
    orgId = org.orgId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: org.fundingSourceId, name: "Travel", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    const [item2] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: org.fundingSourceId, name: "Supplies", scheduledValueCents: 200_000, sortOrder: 1 })
      .returning({ id: lineItems.id });
    lineItemId2 = item2.id;

    await db.insert(paymentSources).values({ orgId, label: "Cash", sortOrder: 0 });

    const other = await createTestOrg({ name: "Other Audit Org", docName: "Other", activeMonth: MONTH });
    otherOrgId = other.orgId;

    const [otherItem] = await db
      .insert(lineItems)
      .values({ orgId: otherOrgId, fundingSourceId: other.fundingSourceId, name: "Other Travel", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    otherLineItemId = otherItem.id;

    userA = await insertUser(orgId);
    userB = await insertUser(orgId);
    otherOrgUser = await insertUser(otherOrgId);
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      if (id) await db.delete(organizations).where(eq(organizations.id, id));
    }
  });

  describe("one event per operation, correct actor", () => {
    it("createExpenseAction writes a 'created' event with the acting user's id", async () => {
      asUser(orgId, userA);
      const result = await createExpenseAction(baseInput());
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");

      const rows = await eventsFor(result.data.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("created");
      expect(rows[0].actorUserId).toBe(userA);
      expect(rows[0].orgId).toBe(orgId);
      expect(rows[0].createdAt).toBeInstanceOf(Date);
    });

    it("updateExpenseAction writes an 'edited' event with the acting user's id, distinct from the creator", async () => {
      asUser(orgId, userA);
      const created = await createExpenseAction(baseInput());
      if (!created.ok) throw new Error("unreachable");
      const id = created.data.id;

      asUser(orgId, userB);
      const result = await updateExpenseAction(baseInput({ id, name: "Renamed" }));
      expect(result.ok).toBe(true);

      const rows = await eventsFor(id);
      expect(rows).toHaveLength(2);
      const edited = rows.find((row) => row.action === "edited")!;
      expect(edited.actorUserId).toBe(userB);
      const createdEvent = rows.find((row) => row.action === "created")!;
      expect(createdEvent.actorUserId).toBe(userA);
    });

    it("deleteExpenseAction writes a 'deleted' event with the acting user's id", async () => {
      asUser(orgId, userA);
      const id = await insertExpense({ orgId, lineItemId });

      asUser(orgId, userB);
      const result = await deleteExpenseAction(id);
      expect(result.ok).toBe(true);

      const rows = await eventsFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("deleted");
      expect(rows[0].actorUserId).toBe(userB);
    });

    it("restoreExpenseAction writes a 'restored' event with the acting user's id", async () => {
      asUser(orgId, userA);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);

      asUser(orgId, userB);
      const result = await restoreExpenseAction(id);
      expect(result.ok).toBe(true);

      const rows = await eventsFor(id);
      const restored = rows.find((row) => row.action === "restored")!;
      expect(restored.actorUserId).toBe(userB);
    });

    it("permanentlyDeleteExpenseAction writes a 'permanently_deleted' event with the acting user's id", async () => {
      asUser(orgId, userA);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);

      asUser(orgId, userB);
      const result = await permanentlyDeleteExpenseAction(id);
      expect(result.ok).toBe(true);

      const rows = await db
        .select()
        .from(expenseAuditEvents)
        .where(and(eq(expenseAuditEvents.orgId, orgId), eq(expenseAuditEvents.actorUserId, userB)));
      const permDelete = rows.find((row) => row.action === "permanently_deleted")!;
      expect(permDelete).toBeDefined();
      expect(permDelete.actorUserId).toBe(userB);
    });
  });

  describe("permanent delete survives with expenseId nulled", () => {
    it("the 'permanently_deleted' event and earlier events for the same expense all survive with expenseId NULL, no FK violation", async () => {
      asUser(orgId, userA);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);

      asUser(orgId, userB);
      // Captured by row id, not by actorUserId — other tests in this same describe block also
      // act as userA against this same org, so filtering by actor alone would pick up
      // unrelated events from other expenses and give a false pass/fail.
      const before = await eventsFor(id);
      const beforeIds = before.map((row) => row.id);
      expect(beforeIds.length).toBeGreaterThan(0);

      const result = await permanentlyDeleteExpenseAction(id);
      expect(result.ok).toBe(true);

      // Expense row itself is gone.
      const expenseRow = await db.select().from(expenses).where(eq(expenses.id, id));
      expect(expenseRow).toHaveLength(0);

      // The earlier 'deleted' event (written by userA) survives, expenseId nulled.
      const survivors = await db
        .select()
        .from(expenseAuditEvents)
        .where(inArray(expenseAuditEvents.id, beforeIds));
      expect(survivors).toHaveLength(beforeIds.length);
      for (const row of survivors) {
        expect(row.expenseId).toBeNull();
        expect(row.actorUserId).toBe(userA);
        expect(row.createdAt).toBeInstanceOf(Date);
      }
      expect(survivors.some((row) => row.action === "deleted")).toBe(true);

      // The 'permanently_deleted' event itself also survives, expenseId nulled.
      const permDeleteRows = await db
        .select()
        .from(expenseAuditEvents)
        .where(and(eq(expenseAuditEvents.orgId, orgId), eq(expenseAuditEvents.actorUserId, userB)));
      const permDelete = permDeleteRows
        .filter((row) => row.action === "permanently_deleted")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      expect(permDelete).toBeDefined();
      expect(permDelete.expenseId).toBeNull();
      expect(permDelete.actorUserId).toBe(userB);
      expect(permDelete.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("failure paths write nothing", () => {
    it("a non-UUID id writes no audit row for any of the four id-taking actions", async () => {
      asUser(orgId, userA);
      const before = (await allEventsForOrg(orgId)).length;
      const bogus = "not-a-uuid";

      await updateExpenseAction(baseInput({ id: bogus }));
      await deleteExpenseAction(bogus);
      await restoreExpenseAction(bogus);
      await permanentlyDeleteExpenseAction(bogus);

      const after = (await allEventsForOrg(orgId)).length;
      expect(after).toBe(before);
    });

    it("a well-formed but nonexistent UUID writes no audit row", async () => {
      asUser(orgId, userA);
      const before = (await allEventsForOrg(orgId)).length;
      const missing = "00000000-0000-0000-0000-000000000000";

      await updateExpenseAction(baseInput({ id: missing }));
      await deleteExpenseAction(missing);
      await restoreExpenseAction(missing);
      await permanentlyDeleteExpenseAction(missing);

      const after = (await allEventsForOrg(orgId)).length;
      expect(after).toBe(before);
    });

    it("another org's expense id writes no audit row in either org", async () => {
      asUser(otherOrgId, otherOrgUser);
      const id = await insertExpense({ orgId: otherOrgId, lineItemId: otherLineItemId });

      asUser(orgId, userA);
      const beforeOrgA = (await allEventsForOrg(orgId)).length;
      const beforeOrgB = (await allEventsForOrg(otherOrgId)).length;

      await expect(deleteExpenseAction(id)).resolves.toMatchObject({ ok: false });
      await expect(restoreExpenseAction(id)).resolves.toMatchObject({ ok: false });
      await expect(permanentlyDeleteExpenseAction(id)).resolves.toMatchObject({ ok: false });
      // lineItemId deliberately left as this (org A's) own line item, so the failure being
      // asserted is the cross-org expense-id scoping, not an unrelated line-item ownership check.
      await expect(updateExpenseAction(baseInput({ id }))).resolves.toMatchObject({
        ok: false,
      });

      expect((await allEventsForOrg(orgId)).length).toBe(beforeOrgA);
      expect((await allEventsForOrg(otherOrgId)).length).toBe(beforeOrgB);
    });

    it("permanent-delete of an expense that is not trashed writes no audit row and the expense survives", async () => {
      asUser(orgId, userA);
      const id = await insertExpense({ orgId, lineItemId });
      const before = (await allEventsForOrg(orgId)).length;

      const result = await permanentlyDeleteExpenseAction(id);
      expect(result.ok).toBe(false);

      const after = (await allEventsForOrg(orgId)).length;
      expect(after).toBe(before);

      const row = await db.select().from(expenses).where(eq(expenses.id, id));
      expect(row).toHaveLength(1);
    });
  });

  describe("loadOrgAuditHistory: cross-org isolation, ordering, batching", () => {
    it("returns nothing for another org's expense id", async () => {
      asUser(otherOrgId, otherOrgUser);
      const id = await insertExpense({ orgId: otherOrgId, lineItemId: otherLineItemId });
      await deleteExpenseAction(id);

      const events = await historyFor(orgId, id);
      expect(events).toHaveLength(0);
    });

    it("returns events newest-first with the correct actor email for each", async () => {
      asUser(orgId, userA);
      const id = await insertExpense({ orgId, lineItemId });

      const [aEmail] = await db.select({ email: users.email }).from(users).where(eq(users.id, userA));
      const [bEmail] = await db.select({ email: users.email }).from(users).where(eq(users.id, userB));

      await deleteExpenseAction(id); // event 1, userA
      await new Promise((resolve) => setTimeout(resolve, 5));

      asUser(orgId, userB);
      await restoreExpenseAction(id); // event 2, userB
      await new Promise((resolve) => setTimeout(resolve, 5));

      asUser(orgId, userA);
      await deleteExpenseAction(id); // event 3, userA

      const events = await historyFor(orgId, id);
      expect(events).toBeDefined();
      // Newest first.
      const times = events.map((event) => event.at.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));

      expect(events[0].actorEmail).toBe(aEmail.email);
      expect(events[1].actorEmail).toBe(bEmail.email);
      expect(events[2].actorEmail).toBe(aEmail.email);
      expect(events.map((event) => event.action)).toEqual(["deleted", "restored", "deleted"]);
    });

    it("batches multiple expenses in one call, keyed correctly, and an unknown org returns nothing", async () => {
      asUser(orgId, userA);
      const idOne = await insertExpense({ orgId, lineItemId });
      const idTwo = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(idOne);
      await deleteExpenseAction(idTwo);
      await restoreExpenseAction(idTwo);

      const { events } = await loadOrgAuditHistory(orgId, { page: 1 });
      expect(events.filter((event) => event.expenseId === idOne).map((event) => event.action)).toEqual([
        "deleted",
      ]);
      expect(events.filter((event) => event.expenseId === idTwo).map((event) => event.action)).toEqual([
        "restored",
        "deleted",
      ]);

      const empty = await loadOrgAuditHistory("00000000-0000-0000-0000-000000000000", { page: 1 });
      expect(empty.events).toHaveLength(0);
      expect(empty.hasNextPage).toBe(false);
    });
  });

  describe("role gating (caller-level contract)", () => {
    it("loadOrgAuditHistory itself has no role check — gating is the caller's job, not the query's", async () => {
      // This proves what is actually testable at the module level without a browser: the
      // query function performs no role check and will happily return data for any orgId
      // it's called with, regardless of the caller's role. `loadExpenseHistoryAction` is the
      // gate — its `requireAdmin()` refuses a manager before this query is ever reached, and
      // the tests below assert exactly that. What stays untested here is the UI side: that
      // the row menu hides "History" from a manager is client rendering, not reachable from
      // this suite, and it is defence in depth rather than the boundary either way.
      asUser(orgId, userA);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);

      const events = await historyFor(orgId, id);
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe("beforeData/afterData snapshot correctness (D-87)", () => {
    it("createExpenseAction: afterData present with the saved fields + resolved lineItemName, beforeData null, money as raw cents", async () => {
      asUser(orgId, userA);
      const result = await createExpenseAction(
        baseInput({ name: "Snapshot Vendor", subtotal: "12.34", tax: "1.00", fees: "0.50" }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");

      const [row] = await eventsFor(result.data.id);
      expect(row.beforeData).toBeNull();
      expect(row.afterData).toMatchObject({
        name: "Snapshot Vendor",
        lineItemId,
        lineItemName: "Travel",
        subtotalCents: 1234,
        taxCents: 100,
        feesCents: 50,
      });
      // Raw integer cents, not a formatted "$12.34" string.
      const after = row.afterData as { subtotalCents: unknown };
      expect(typeof after.subtotalCents).toBe("number");
    });

    it("updateExpenseAction moving to a different line item: beforeData.lineItemName is the OLD line item, afterData.lineItemName is the NEW one", async () => {
      asUser(orgId, userA);
      const created = await createExpenseAction(baseInput({ lineItemId, name: "Mover" }));
      if (!created.ok) throw new Error("unreachable");
      const id = created.data.id;

      const result = await updateExpenseAction(baseInput({ id, lineItemId: lineItemId2, name: "Mover" }));
      expect(result.ok).toBe(true);

      const rows = await eventsFor(id);
      const edited = rows.find((row) => row.action === "edited")!;
      expect(edited.beforeData).toMatchObject({ lineItemId, lineItemName: "Travel" });
      expect(edited.afterData).toMatchObject({ lineItemId: lineItemId2, lineItemName: "Supplies" });
    });

    it("updateExpenseAction: both beforeData and afterData present, before reflects pre-update values", async () => {
      asUser(orgId, userA);
      const created = await createExpenseAction(baseInput({ name: "Original", subtotal: "5.00" }));
      if (!created.ok) throw new Error("unreachable");
      const id = created.data.id;

      const result = await updateExpenseAction(baseInput({ id, name: "Updated", subtotal: "9.99" }));
      expect(result.ok).toBe(true);

      const rows = await eventsFor(id);
      const edited = rows.find((row) => row.action === "edited")!;
      expect(edited.beforeData).toMatchObject({ name: "Original", subtotalCents: 500 });
      expect(edited.afterData).toMatchObject({ name: "Updated", subtotalCents: 999 });
    });

    it("deleteExpenseAction: beforeData present matching the row, afterData null", async () => {
      asUser(orgId, userA);
      const id = await insertExpense({ orgId, lineItemId });

      const result = await deleteExpenseAction(id);
      expect(result.ok).toBe(true);

      const rows = await eventsFor(id);
      const deleted = rows.find((row) => row.action === "deleted")!;
      expect(deleted.afterData).toBeNull();
      expect(deleted.beforeData).toMatchObject({ lineItemId, lineItemName: "Travel", subtotalCents: 1000 });
    });

    it("restoreExpenseAction: afterData present matching the row, beforeData null", async () => {
      asUser(orgId, userA);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);

      const result = await restoreExpenseAction(id);
      expect(result.ok).toBe(true);

      const rows = await eventsFor(id);
      const restored = rows.find((row) => row.action === "restored")!;
      expect(restored.beforeData).toBeNull();
      expect(restored.afterData).toMatchObject({ lineItemId, lineItemName: "Travel", subtotalCents: 1000 });
    });

    it("permanentlyDeleteExpenseAction: beforeData present matching the row's last known values, afterData null", async () => {
      asUser(orgId, userA);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);

      const result = await permanentlyDeleteExpenseAction(id);
      expect(result.ok).toBe(true);

      const rows = await db
        .select()
        .from(expenseAuditEvents)
        .where(and(eq(expenseAuditEvents.orgId, orgId), eq(expenseAuditEvents.actorUserId, userA)));
      const permDelete = rows
        .filter((row) => row.action === "permanently_deleted")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      expect(permDelete.afterData).toBeNull();
      expect(permDelete.beforeData).toMatchObject({ lineItemId, lineItemName: "Travel", subtotalCents: 1000 });
    });
  });

  describe("loadOrgAuditHistory: expenseName/reference fallback after permanent delete", () => {
    it("expenseName falls back to beforeData.name and reference is null once the expense row is gone", async () => {
      asUser(orgId, userA);
      const id = await createExpenseAction(
        baseInput({ name: "Gone For Good", month: MONTH, subtotal: "3.00" }),
      );
      if (!id.ok) throw new Error("unreachable");
      await deleteExpenseAction(id.data.id);
      await permanentlyDeleteExpenseAction(id.data.id);

      const { events } = await loadOrgAuditHistory(orgId, { page: 1 });
      const permDelete = events.find(
        (event) => event.action === "permanently_deleted" && event.beforeData?.name === "Gone For Good",
      );
      expect(permDelete).toBeDefined();
      expect(permDelete!.expenseId).toBeNull();
      expect(permDelete!.reference).toBeNull();
      expect(permDelete!.expenseName).toBe("Gone For Good");
    });
  });

  describe("loadOrgAuditHistory: action-type filter guards an unknown value", () => {
    it("an invalid actionType string neither crashes nor silently returns unfiltered results as if it matched", async () => {
      asUser(orgId, userA);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);
      await restoreExpenseAction(id);

      const unfiltered = await loadOrgAuditHistory(orgId, { page: 1 });
      const bogus = await loadOrgAuditHistory(orgId, {
        page: 1,
        actionType: "not_a_real_action" as unknown as ExpenseAuditActionType,
      });
      // The guard (`expenseAuditAction.enumValues.includes`) must treat an unrecognised value
      // exactly like "no filter" — same result set as calling with no actionType at all.
      expect(bogus.events.map((event) => event.id)).toEqual(unfiltered.events.map((event) => event.id));

      const validFiltered = await loadOrgAuditHistory(orgId, { page: 1, actionType: "deleted" });
      expect(validFiltered.events.every((event) => event.action === "deleted")).toBe(true);
      expect(validFiltered.events.length).toBeLessThan(unfiltered.events.length);
    });
  });

  describe("loadOrgAuditHistory: cross-org isolation of snapshots and names", () => {
    it("org A never sees org B's snapshot data or expense names, even directly", async () => {
      asUser(otherOrgId, otherOrgUser);
      const otherId = await insertExpense({ orgId: otherOrgId, lineItemId: otherLineItemId });
      await deleteExpenseAction(otherId);

      asUser(orgId, userA);
      const { events } = await loadOrgAuditHistory(orgId, { page: 1 });
      expect(events.some((event) => event.expenseId === otherId)).toBe(false);

      const otherHistory = await loadOrgAuditHistory(otherOrgId, { page: 1 });
      expect(otherHistory.events.some((event) => event.expenseId === otherId)).toBe(true);
      // Org A's page never contains org B's line item name anywhere in its snapshots.
      const orgALineItemNames = events
        .flatMap((event) => [event.beforeData?.lineItemName, event.afterData?.lineItemName])
        .filter(Boolean);
      expect(orgALineItemNames).not.toContain("Other Travel");
    });
  });

  describe("loadOrgAuditHistory: pagination boundaries (50 / 51 / 101)", () => {
    let pageOrgId: string;
    let pageUserId: string;

    async function insertRawEvents(count: number) {
      const rows = Array.from({ length: count }, () => ({
        orgId: pageOrgId,
        expenseId: null,
        actorUserId: pageUserId,
        action: "created" as const,
      }));
      await db.insert(expenseAuditEvents).values(rows);
    }

    beforeAll(async () => {
      const org = await createTestOrg({ name: "Pagination Org", docName: "Pagination", activeMonth: MONTH });
      pageOrgId = org.orgId;
      pageUserId = await insertUser(pageOrgId);
    });

    afterAll(async () => {
      await db.delete(organizations).where(eq(organizations.id, pageOrgId));
    });

    it("exactly 50 events: one full page, no next page", async () => {
      await insertRawEvents(50);

      const page1 = await loadOrgAuditHistory(pageOrgId, { page: 1 });
      expect(page1.events).toHaveLength(50);
      expect(page1.hasNextPage).toBe(false);

      const page2 = await loadOrgAuditHistory(pageOrgId, { page: 2 });
      expect(page2.events).toHaveLength(0);
      expect(page2.hasNextPage).toBe(false);
    });

    it("51 events: page 1 full with hasNextPage true, page 2 has exactly the 1 remaining row", async () => {
      await insertRawEvents(1); // 51 total

      const page1 = await loadOrgAuditHistory(pageOrgId, { page: 1 });
      expect(page1.events).toHaveLength(50);
      expect(page1.hasNextPage).toBe(true);

      const page2 = await loadOrgAuditHistory(pageOrgId, { page: 2 });
      expect(page2.events).toHaveLength(1);
      expect(page2.hasNextPage).toBe(false);
    });

    it("101 events: three pages, 50/50/1, hasNextPage true/true/false", async () => {
      await insertRawEvents(50); // 101 total

      const page1 = await loadOrgAuditHistory(pageOrgId, { page: 1 });
      expect(page1.events).toHaveLength(50);
      expect(page1.hasNextPage).toBe(true);

      const page2 = await loadOrgAuditHistory(pageOrgId, { page: 2 });
      expect(page2.events).toHaveLength(50);
      expect(page2.hasNextPage).toBe(true);

      const page3 = await loadOrgAuditHistory(pageOrgId, { page: 3 });
      expect(page3.events).toHaveLength(1);
      expect(page3.hasNextPage).toBe(false);

      // No overlap between pages (distinct ids across the full walk).
      const allIds = [...page1.events, ...page2.events, ...page3.events].map((event) => event.id);
      expect(new Set(allIds).size).toBe(101);
    });
  });

  describe("actorName for a legacy account with no name on file (D-89)", () => {
    it("actorName is null while actorEmail is intact, and userDisplay falls back to the email", async () => {
      // insertUser() never sets `name`, so userA is exactly a legacy (pre-D-89) account.
      asUser(orgId, userA);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);

      const [aRow] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userA));
      expect(aRow.name).toBeNull();

      const events = await historyFor(orgId, id);
      const deleted = events.find((event) => event.action === "deleted")!;
      expect(deleted.actorName).toBeNull();
      expect(deleted.actorEmail).toBe(aRow.email);

      const { userDisplay } = await import("@/src/domain/user-display");
      expect(userDisplay(deleted.actorName, deleted.actorEmail)).toBe(aRow.email);
    });
  });

  describe("loadOrgAuditHistory: per-expense scoping via the expenseId option (D-89)", () => {
    it("returns only the given expense's events, not a second expense's in the same org", async () => {
      asUser(orgId, userA);
      const idOne = await insertExpense({ orgId, lineItemId });
      const idTwo = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(idOne);
      await deleteExpenseAction(idTwo);
      await restoreExpenseAction(idTwo);

      const { events } = await loadOrgAuditHistory(orgId, { expenseId: idOne });
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((event) => event.expenseId === idOne)).toBe(true);
      expect(events.some((event) => event.expenseId === idTwo)).toBe(false);
    });

    it("a non-uuid expenseId returns an empty result instead of throwing", async () => {
      const { events, hasNextPage } = await loadOrgAuditHistory(orgId, { expenseId: "not-a-uuid" });
      expect(events).toHaveLength(0);
      expect(hasNextPage).toBe(false);
    });

    it("an expenseId belonging to another org returns empty when called with this org's id", async () => {
      asUser(otherOrgId, otherOrgUser);
      const otherExpenseId = await insertExpense({ orgId: otherOrgId, lineItemId: otherLineItemId });
      await deleteExpenseAction(otherExpenseId);

      const { events } = await loadOrgAuditHistory(orgId, { expenseId: otherExpenseId });
      expect(events).toHaveLength(0);

      // Sanity: the same expenseId, queried with its OWN org, does return events.
      const own = await loadOrgAuditHistory(otherOrgId, { expenseId: otherExpenseId });
      expect(own.events.length).toBeGreaterThan(0);
    });
  });

  describe("loadExpenseHistoryAction: admin-only server action (D-89)", () => {
    it("a manager is refused with FORBIDDEN and gets no data", async () => {
      asUser(orgId, userA);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);

      asUser(orgId, userA, "manager");
      const result = await loadExpenseHistoryAction(id);
      expect(result).toEqual({ ok: false, error: FORBIDDEN });
    });

    it("an admin gets back exactly this expense's events, scoped", async () => {
      asUser(orgId, userA);
      const idOne = await insertExpense({ orgId, lineItemId });
      const idTwo = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(idOne);
      await deleteExpenseAction(idTwo);

      const result = await loadExpenseHistoryAction(idOne);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.events.length).toBeGreaterThan(0);
      expect(result.data.events.every((event) => event.expenseId === idOne)).toBe(true);
      // Two events on one expense is nowhere near a page, so the UI must not be told to
      // claim history was withheld.
      expect(result.data.truncated).toBe(false);
    });

    it("a non-uuid expenseId returns a failure rather than throwing", async () => {
      asUser(orgId, userA);
      const result = await loadExpenseHistoryAction("not-a-uuid");
      expect(result.ok).toBe(false);
    });
  });
});
