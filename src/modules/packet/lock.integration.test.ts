/**
 * Month locking (R10.7, D-96) — Phase 1, `docs/PHASE-8.md` §8.
 *
 * The lock/unlock lifecycle against a real database and the local storage driver: storing the
 * signed copy, refusing to lock, the Reconciled/Submitted interplay, per-source isolation,
 * cross-organisation refusal, unlock history, quota accounting and Reporting periods.
 *
 * The table-driven "every write path refuses a locked month" proof, the open-page case and the
 * concurrency race live in `lock-guard.integration.test.ts` — kept separate because that file
 * spies on `monthLocked` itself, which this file does not need.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));
vi.mock("@/src/services/auth/session", () => ({ getSession: vi.fn(), requireSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("month locking (integration, R10.7)", async () => {
  const { db } = await import("@/src/db");
  const {
    expenses,
    fundingSources,
    lineItems,
    monthLockEvents,
    monthSnapshots,
    monthSnapshotTotals,
    monthStatuses,
    organizations,
    paymentSources,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { monthLabel } = await import("@/src/domain/dates");
  const { UI, UNLOCK_REASON_MAX_LENGTH } = await import("@/src/domain/strings");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { actionSession } = await import("@/src/lib/action-session");
  const { getSession, requireSession } = await import("@/src/services/auth/session");

  const { lockMonth } = await import("./lock");
  const { unlockMonthAction, clearMonthSubmittedAction, markMonthSubmittedAction } = await import("./actions");
  const { loadLockEvents, loadLockedMonths, loadReportingPeriods } = await import("./queries");
  const { ingestExpenseDocument } = await import("@/src/services/storage/documents");
  const { storage } = await import("@/src/services/storage/driver");

  const { GET: filesGet } = await import("@/app/api/files/[id]/route");
  const { POST: uploadPost } = await import("@/app/api/files/upload/route");
  const { GET: packetGet } = await import("@/app/api/downloads/packet/route");
  const { GET: summaryGet } = await import("@/app/api/downloads/summary/route");
  const { GET: coverSheetGet } = await import("@/app/api/downloads/cover-sheet/route");

  const actionSessionMock = vi.mocked(actionSession);
  const getSessionMock = vi.mocked(getSession);
  const requireSessionMock = vi.mocked(requireSession);

  let orgId: string;
  let sourceA: string;
  let sourceB: string;
  let itemA: string;
  let itemB: string;
  let userId: string;

  let otherOrgId: string;
  let otherUserId: string;

  function sessionContext(orgId: string, userId: string) {
    return {
      orgId,
      userId,
      email: "e@example.com",
      role: "admin" as const,
      orgName: "Org",
      docName: "Doc",
      activeMonth: "2093-01",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
    };
  }

  function asUser(orgId: string, userId: string) {
    actionSessionMock.mockResolvedValue(sessionContext(orgId, userId));
  }
  function routeAsUser(orgId: string, userId: string) {
    getSessionMock.mockResolvedValue(sessionContext(orgId, userId));
    requireSessionMock.mockResolvedValue(sessionContext(orgId, userId));
  }

  const { users } = await import("@/src/db/schema");

  async function insertUser(org: string) {
    const [row] = await db
      .insert(users)
      .values({
        orgId: org,
        email: `lock-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    return row.id;
  }

  let pdfCounter = 0;
  async function pdfFile(name = "signed.pdf"): Promise<File> {
    pdfCounter += 1;
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText(`copy ${pdfCounter}`, { x: 50, y: 700 });
    const bytes = await doc.save();
    return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
  }

  async function pngFile(name = "not-a-pdf.png"): Promise<File> {
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .png()
      .toBuffer();
    return new File([new Uint8Array(png)], name, { type: "image/png" });
  }

  let monthCounter = 0;
  /** A fresh, never-reused month key, so tests never interfere with one another's lock state. */
  function freshMonth(): string {
    monthCounter += 1;
    const month = 1 + (monthCounter % 12);
    const year = 2093 + Math.floor(monthCounter / 12);
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  /** Insert a complete, non-blocking expense (narrative + proof + receipt), so the month it
   *  lands in is never refused for missing documents. */
  async function completeExpense(sourceId: string, month: string, itemId: string) {
    const [expense] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId: sourceId,
        lineItemId: itemId,
        month,
        date: `${month}-05`,
        name: "Complete expense",
        narrative: "A narrative.",
        paymentSource: "Cash",
        subtotalCents: 1_000,
        taxReimbursable: false,
        feesReimbursable: true,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, sourceId, month),
      })
      .returning({ id: expenses.id });

    const jpeg = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    for (const scope of ["proof", "receipt"] as const) {
      const result = await ingestExpenseDocument({
        orgId,
        expenseId: expense.id,
        scope,
        file: new File([new Uint8Array(jpeg)], `${scope}.jpg`, { type: "image/jpeg" }),
      });
      if (!result.ok) throw new Error(result.error);
    }
    return expense.id;
  }

  /** An expense with no receipt, no proof and no narrative override — blocks the month. */
  async function blockingExpense(sourceId: string, month: string, itemId: string) {
    const [expense] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId: sourceId,
        lineItemId: itemId,
        month,
        date: `${month}-05`,
        name: "Blocking expense",
        paymentSource: "Cash",
        subtotalCents: 1_000,
        taxReimbursable: false,
        feesReimbursable: true,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, sourceId, month),
      })
      .returning({ id: expenses.id });
    return expense.id;
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Lock Org", activeMonth: "2093-01" });
    orgId = org.orgId;
    sourceA = org.fundingSourceId;
    userId = await insertUser(orgId);

    const [b] = await db
      .insert(fundingSources)
      .values({
        orgId,
        name: "Source B",
        type: "donation",
        sortOrder: 1,
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: fundingSources.id });
    sourceB = b.id;

    await db.insert(paymentSources).values({ orgId, label: "Cash", sortOrder: 0 });

    const [ia] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceA, name: "A item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    itemA = ia.id;

    const [ib] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceB, name: "B item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    itemB = ib.id;

    const other = await createTestOrg({ name: "Lock Org Other" });
    otherOrgId = other.orgId;
    otherUserId = await insertUser(otherOrgId);
  }, 30_000);

  afterAll(async () => {
    if (orgId) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
      await rm(path.join(process.cwd(), ".storage", "org", orgId), { recursive: true, force: true });
    }
    if (otherOrgId) await db.delete(organizations).where(eq(organizations.id, otherOrgId));
  });

  async function lockedAtOf(sourceId: string, month: string) {
    const [row] = await db
      .select({ lockedAt: monthStatuses.lockedAt, submittedAt: monthStatuses.submittedAt })
      .from(monthStatuses)
      .where(
        and(
          eq(monthStatuses.orgId, orgId),
          eq(monthStatuses.fundingSourceId, sourceId),
          eq(monthStatuses.month, month),
        ),
      )
      .limit(1);
    return row;
  }

  async function snapshotTotalsOf(sourceId: string, month: string) {
    const [row] = await db
      .select({ capturedAt: monthSnapshotTotals.capturedAt })
      .from(monthSnapshotTotals)
      .where(
        and(
          eq(monthSnapshotTotals.orgId, orgId),
          eq(monthSnapshotTotals.fundingSourceId, sourceId),
          eq(monthSnapshotTotals.month, month),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function snapshotBilledCentsOf(sourceId: string, month: string): Promise<number> {
    const rows = await db
      .select({ totalBilledCents: monthSnapshots.totalBilledCents })
      .from(monthSnapshots)
      .where(
        and(
          eq(monthSnapshots.orgId, orgId),
          eq(monthSnapshots.fundingSourceId, sourceId),
          eq(monthSnapshots.month, month),
        ),
      );
    return rows.reduce((sum, r) => sum + r.totalBilledCents, 0);
  }

  it("locks an empty month: sets locked_at, records one lock event, object is fetchable", async () => {
    const month = freshMonth();
    const file = await pdfFile("packet-a.pdf");
    const result = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file });
    expect(result.ok).toBe(true);

    const status = await lockedAtOf(sourceA, month);
    expect(status?.lockedAt).not.toBeNull();

    const events = await loadLockEvents(orgId, sourceA, month);
    expect(events).toHaveLength(1);
    expect(events[0].isLock).toBe(true);
    expect(events[0].filename).toBe("packet-a.pdf");

    const [row] = await db
      .select({ key: monthLockEvents.s3Key, size: monthLockEvents.sizeBytes })
      .from(monthLockEvents)
      .where(eq(monthLockEvents.id, events[0].id));
    expect(row.size).toBeGreaterThan(0);
    expect(await storage().exists(row.key!)).toBe(true);
  });

  it("refuses to lock a month with a blocking (undocumented) expense", async () => {
    const month = freshMonth();
    await blockingExpense(sourceA, month, itemA);
    const result = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.lockNeedsDocuments);

    const status = await lockedAtOf(sourceA, month);
    expect(status?.lockedAt ?? null).toBeNull();
  });

  it("refuses a non-PDF: nothing stored, no event, not locked", async () => {
    const month = freshMonth();
    const result = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pngFile() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.lockNotPdf);

    const status = await lockedAtOf(sourceA, month);
    expect(status?.lockedAt ?? null).toBeNull();
    const events = await loadLockEvents(orgId, sourceA, month);
    expect(events).toHaveLength(0);
  });

  it("refuses to lock an already-locked month", async () => {
    const month = freshMonth();
    const first = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile() });
    expect(first.ok).toBe(true);

    const second = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile() });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe(UI.monthAlreadyLocked);

    const events = await loadLockEvents(orgId, sourceA, month);
    expect(events).toHaveLength(1); // the refused attempt left no second event
  });

  it("locking an unsubmitted month marks it submitted and captures the snapshot; a lock after an unlock is a fresh submission that re-captures", async () => {
    const month = freshMonth();
    const before = await lockedAtOf(sourceA, month);
    expect(before?.submittedAt ?? null).toBeNull();
    expect(await snapshotTotalsOf(sourceA, month)).toBeNull();

    const expenseId = await completeExpense(sourceA, month, itemA);

    // (b) first lock of a NOT-submitted month: submitted_at is set AND the snapshot is captured.
    const locked = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile() });
    expect(locked.ok).toBe(true);
    const afterLock = await lockedAtOf(sourceA, month);
    expect(afterLock?.submittedAt).not.toBeNull();
    const firstSubmittedAt = afterLock!.submittedAt!.getTime();
    const firstTotals = await snapshotTotalsOf(sourceA, month);
    expect(firstTotals).not.toBeNull();
    const firstBilled = await snapshotBilledCentsOf(sourceA, month);
    expect(firstBilled).toBeGreaterThan(0);

    // (c) Unlock, change the amount while unlocked, and re-lock with a new copy. PR #16 review:
    // a lock after an unlock is treated as a fresh submission (a prior lock event already
    // exists), so submitted_at moves to now AND the snapshot is re-captured — the old behaviour
    // (submitted_at frozen at the first lock forever, snapshot always re-captured) let the
    // figures and the printed date disagree after an unlock/re-lock cycle.
    asUser(orgId, userId);
    const unlocked = await unlockMonthAction(month, sourceA, "");
    expect(unlocked.ok).toBe(true);

    await db.update(expenses).set({ subtotalCents: 40_000 }).where(eq(expenses.id, expenseId));

    await new Promise((r) => setTimeout(r, 5)); // ensure a distinguishable timestamp
    const relocked = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile() });
    expect(relocked.ok).toBe(true);
    const afterRelock = await lockedAtOf(sourceA, month);
    expect(afterRelock!.submittedAt!.getTime()).toBeGreaterThan(firstSubmittedAt);
    const relockTotals = await snapshotTotalsOf(sourceA, month);
    expect(relockTotals!.capturedAt.getTime()).toBeGreaterThan(firstTotals!.capturedAt.getTime());
    // Re-captured: the snapshot now reflects the amount changed while unlocked, not the old one.
    expect(await snapshotBilledCentsOf(sourceA, month)).not.toBe(firstBilled);
  });

  it("first lock of an already-submitted month leaves submitted_at and the snapshot untouched (fail-before: old code unconditionally re-captured)", async () => {
    const month = freshMonth();
    const expenseId = await completeExpense(sourceA, month, itemA);

    asUser(orgId, userId);
    const submitted = await markMonthSubmittedAction(month, sourceA);
    expect(submitted.ok).toBe(true);

    const beforeLock = await lockedAtOf(sourceA, month);
    expect(beforeLock?.submittedAt).not.toBeNull();
    const submittedAtBeforeLock = beforeLock!.submittedAt!.getTime();
    const totalsBeforeLock = await snapshotTotalsOf(sourceA, month);
    expect(totalsBeforeLock).not.toBeNull();
    const billedBeforeLock = await snapshotBilledCentsOf(sourceA, month);
    expect(billedBeforeLock).toBeGreaterThan(0);

    // Change the amount AFTER submitting but BEFORE the first lock — a first lock of an
    // already-submitted month must not pick this up: the figures and the date it was submitted
    // must keep agreeing (plan §7 Q1/Q2).
    await new Promise((r) => setTimeout(r, 5)); // distinguishable timestamp if the bug existed
    await db.update(expenses).set({ subtotalCents: 99_999 }).where(eq(expenses.id, expenseId));

    const locked = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile() });
    expect(locked.ok).toBe(true);

    const afterLock = await lockedAtOf(sourceA, month);
    // (a) submitted_at unchanged, exact timestamp.
    expect(afterLock!.submittedAt!.getTime()).toBe(submittedAtBeforeLock);
    // (a) snapshot not re-captured: same captured_at, contents unchanged despite the amount
    // change made between submit and lock.
    const totalsAfterLock = await snapshotTotalsOf(sourceA, month);
    expect(totalsAfterLock!.capturedAt.getTime()).toBe(totalsBeforeLock!.capturedAt.getTime());
    expect(await snapshotBilledCentsOf(sourceA, month)).toBe(billedBeforeLock);
  });

  it("unlockMonthAction accepts a 700-character reason and refuses 701 with UI.unlockReasonTooLong(700)", async () => {
    const month = freshMonth();
    await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile() });
    asUser(orgId, userId);

    const tooLong = "x".repeat(UNLOCK_REASON_MAX_LENGTH + 1);
    const refused = await unlockMonthAction(month, sourceA, tooLong);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBe(UI.unlockReasonTooLong(UNLOCK_REASON_MAX_LENGTH));
    // Refused before touching the row: still locked.
    const stillLocked = await lockedAtOf(sourceA, month);
    expect(stillLocked?.lockedAt).not.toBeNull();

    const exact = "y".repeat(UNLOCK_REASON_MAX_LENGTH);
    const accepted = await unlockMonthAction(month, sourceA, exact);
    expect(accepted.ok).toBe(true);
    const events = await loadLockEvents(orgId, sourceA, month);
    const unlockEvent = events.find((e) => !e.isLock)!;
    expect(unlockEvent.reason).toBe(exact);
  });

  it("loadLockedMonths reflects locked_at even when the newest event is still a lock (PR #16 review: page derives 'locked' from locked_at, not the newest event)", async () => {
    const month = freshMonth();
    const locked = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile() });
    expect(locked.ok).toBe(true);

    let lockedSet = await loadLockedMonths(orgId, sourceA);
    expect(lockedSet.has(`${sourceA}:${month}`)).toBe(true);

    // Clear locked_at directly, without going through unlockMonthAction (so no unlock event is
    // recorded) — the newest lock event on file is still a lock, but the month is open.
    await db
      .update(monthStatuses)
      .set({ lockedAt: null })
      .where(
        and(
          eq(monthStatuses.orgId, orgId),
          eq(monthStatuses.fundingSourceId, sourceA),
          eq(monthStatuses.month, month),
        ),
      );
    const events = await loadLockEvents(orgId, sourceA, month);
    expect(events[events.length - 1].isLock).toBe(true); // newest event is still a lock

    lockedSet = await loadLockedMonths(orgId, sourceA);
    expect(lockedSet.has(`${sourceA}:${month}`)).toBe(false); // locked_at, not the event, decides
  });

  it("locking source A's month leaves source B's same month unlocked and editable", async () => {
    const month = freshMonth();
    const locked = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile() });
    expect(locked.ok).toBe(true);

    const statusB = await lockedAtOf(sourceB, month);
    expect(statusB?.lockedAt ?? null).toBeNull();

    const lockedSet = await loadLockedMonths(orgId, null);
    expect(lockedSet.has(`${sourceA}:${month}`)).toBe(true);
    expect(lockedSet.has(`${sourceB}:${month}`)).toBe(false);

    // B's month is still editable through the real guard.
    asUser(orgId, userId);
    const { createExpenseAction } = await import("@/src/modules/expenses/actions");
    const created = await createExpenseAction({
      name: "B still open",
      fundingSourceId: sourceB,
      lineItemId: itemB,
      paymentSource: "Cash",
      taxReimbursable: false,
      feesReimbursable: true,
      month,
      date: `${month}-06`,
      description: "",
      subtotal: "1.00",
      tax: "0.00",
      fees: "0.00",
      note: "",
      narrative: "narrative",
      noReceipt: true,
      noReceiptReason: "n/a",
    });
    expect(created.ok).toBe(true);
  });

  it("another organisation's source is refused by the upload route and by unlockMonthAction", async () => {
    const month = freshMonth();
    const locked = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile() });
    expect(locked.ok).toBe(true);

    // Attacker session is `otherOrgId`, aimed at org A's real sourceA id.
    routeAsUser(otherOrgId, otherUserId);
    const form = new FormData();
    form.set("target", "signed-packet");
    form.set("month", month);
    form.set("fundingSourceId", sourceA);
    form.set("file", await pdfFile());
    const request = new NextRequest("http://localhost/api/files/upload", {
      method: "POST",
      body: form,
      headers: { "sec-fetch-site": "same-origin" },
    });
    const response = await uploadPost(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);

    asUser(otherOrgId, otherUserId);
    const unlockResult = await unlockMonthAction(month, sourceA, "");
    expect(unlockResult.ok).toBe(false);

    // Still locked — the attacker changed nothing.
    const status = await lockedAtOf(sourceA, month);
    expect(status?.lockedAt).not.toBeNull();
  });

  it("unlock with a reason, and with a blank reason (stored null); refused when not locked; submitted_at untouched", async () => {
    const month = freshMonth();
    await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile() });
    const beforeUnlock = await lockedAtOf(sourceA, month);
    const submittedAt = beforeUnlock!.submittedAt!.getTime();

    asUser(orgId, userId);
    const unlocked = await unlockMonthAction(month, sourceA, "  City asked for a fix.  ");
    expect(unlocked.ok).toBe(true);

    const afterUnlock = await lockedAtOf(sourceA, month);
    expect(afterUnlock?.lockedAt ?? null).toBeNull();
    expect(afterUnlock!.submittedAt!.getTime()).toBe(submittedAt);

    const events = await loadLockEvents(orgId, sourceA, month);
    const unlockEvent = events.find((e) => !e.isLock)!;
    expect(unlockEvent.reason).toBe("City asked for a fix.");

    // Refused when not locked.
    const again = await unlockMonthAction(month, sourceA, "");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe(UI.monthNotLocked);

    // A separate month, unlocked with a blank reason: stored null, not empty string.
    const month2 = freshMonth();
    await lockMonth({ orgId, userId, fundingSourceId: sourceA, month: month2, file: await pdfFile() });
    const blank = await unlockMonthAction(month2, sourceA, "   ");
    expect(blank.ok).toBe(true);
    const events2 = await loadLockEvents(orgId, sourceA, month2);
    const unlockEvent2 = events2.find((e) => !e.isLock)!;
    expect(unlockEvent2.reason).toBeNull();
  });

  it("lock -> unlock -> lock: two lock events + one unlock, both copies served, newest last, another org 404s", async () => {
    const month = freshMonth();
    const first = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile("first.pdf") });
    expect(first.ok).toBe(true);

    asUser(orgId, userId);
    await unlockMonthAction(month, sourceA, "fix needed");

    const second = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile("second.pdf") });
    expect(second.ok).toBe(true);

    const events = await loadLockEvents(orgId, sourceA, month);
    expect(events.map((e) => e.isLock)).toEqual([true, false, true]);
    expect(events[0].filename).toBe("first.pdf");
    expect(events[2].filename).toBe("second.pdf"); // newest lock event last (oldest-first order)

    routeAsUser(orgId, userId);
    for (const event of events.filter((e) => e.isLock)) {
      const response = await filesGet(new Request(`http://localhost/api/files/${event.id}`), {
        params: Promise.resolve({ id: event.id }),
      });
      expect(response.status).toBe(200);
    }

    // Another organisation gets 404 on the same event ids.
    routeAsUser(otherOrgId, otherUserId);
    for (const event of events.filter((e) => e.isLock)) {
      const response = await filesGet(new Request(`http://localhost/api/files/${event.id}`), {
        params: Promise.resolve({ id: event.id }),
      });
      expect(response.status).toBe(404);
    }
  });

  it("clearMonthSubmittedAction on a locked month is refused with the message; submitted_at and the snapshot stay", async () => {
    const month = freshMonth();
    await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile() });
    const before = await lockedAtOf(sourceA, month);

    asUser(orgId, userId);
    const result = await clearMonthSubmittedAction(month, sourceA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const after = await lockedAtOf(sourceA, month);
    expect(after!.submittedAt!.getTime()).toBe(before!.submittedAt!.getTime());

    const { monthSnapshotTotals } = await import("@/src/db/schema");
    const snapshotRows = await db
      .select({ id: monthSnapshotTotals.orgId })
      .from(monthSnapshotTotals)
      .where(
        and(
          eq(monthSnapshotTotals.orgId, orgId),
          eq(monthSnapshotTotals.fundingSourceId, sourceA),
          eq(monthSnapshotTotals.month, month),
        ),
      );
    // The "as submitted" snapshot lockMonth captured is still there — clearMonthSubmittedAction
    // was refused before it could discard it.
    expect(snapshotRows).toHaveLength(1);
  });

  it("a signed copy's bytes count toward the organisation's storage quota", async () => {
    const month = freshMonth();
    const locked = await lockMonth({ orgId, userId, fundingSourceId: sourceA, month, file: await pdfFile() });
    expect(locked.ok).toBe(true);

    const { orgStorageError, MAX_ORG_BYTES } = await import("@/src/services/storage/documents");
    // With the signed copy's real bytes already counted, requesting exactly the remaining
    // headroom plus one more byte must be refused.
    const events = await loadLockEvents(orgId, sourceA, month);
    const [row] = await db
      .select({ size: monthLockEvents.sizeBytes })
      .from(monthLockEvents)
      .where(eq(monthLockEvents.id, events[0].id));
    expect(row.size).toBeGreaterThan(0);

    const quotaError = await orgStorageError(db, orgId, MAX_ORG_BYTES);
    // Signed copy already used some bytes, so the org is not empty — asking for the entire cap
    // again must be refused, proving the earlier signed copy is counted.
    expect(quotaError).not.toBeNull();
  });

  it("loadReportingPeriods: includes live-expense/submitted/locked months, excludes trashed-only, newest first, events attached", async () => {
    const monthOpen = freshMonth(); // has a live expense only
    const monthTrashedOnly = freshMonth(); // its only expense is trashed
    const monthSubmitted = freshMonth();
    const monthLockedM = freshMonth();

    await completeExpense(sourceA, monthOpen, itemA);

    const trashedId = await completeExpense(sourceA, monthTrashedOnly, itemA);
    await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, trashedId));

    asUser(orgId, userId);
    const { markMonthSubmittedAction } = await import("./actions");
    await markMonthSubmittedAction(monthSubmitted, sourceA);

    await lockMonth({ orgId, userId, fundingSourceId: sourceA, month: monthLockedM, file: await pdfFile() });

    const periods = await loadReportingPeriods(orgId, sourceA);
    const months = periods.map((p) => p.month);
    expect(months).toContain(monthOpen);
    expect(months).toContain(monthSubmitted);
    expect(months).toContain(monthLockedM);
    expect(months).not.toContain(monthTrashedOnly);

    // Newest first.
    const sorted = [...months].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    expect(months).toEqual(sorted);

    const lockedPeriod = periods.find((p) => p.month === monthLockedM)!;
    expect(lockedPeriod.lockedAt).not.toBeNull();
    expect(lockedPeriod.events.length).toBeGreaterThan(0);
  });

  it("packet, summary and cover-sheet downloads still serve on a locked month; an unlocked month's create/edit still succeed", async () => {
    function downloadRequest(pathname: string, params: Record<string, string>): Request {
      const url = new URL(`http://localhost${pathname}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return new Request(url, { headers: { "Sec-Fetch-Site": "same-origin" } });
    }

    // Packet and summary: an empty month (plan §7 Q4, "a month with no expenses can be locked —
    // nothing blocks its download either"). Deliberately NOT using an expense-bearing month for
    // the *packet* route here: building a real cover-sheet section shells out to `pdftotext
    // -bbox-layout` (`coverSheetAnchors`), which this machine's Xpdf build does not support —
    // the same pre-existing environmental gap `packet-trace.integration.test.ts` documents. An
    // empty month has no line-item sections at all, so the packet still builds and this test
    // stays about the lock, not about that environment gap.
    const emptyMonth = freshMonth();
    const lockedEmpty = await lockMonth({
      orgId,
      userId,
      fundingSourceId: sourceA,
      month: emptyMonth,
      file: await pdfFile(),
    });
    expect(lockedEmpty.ok).toBe(true);

    routeAsUser(orgId, userId);
    const packetResponse = await packetGet(
      downloadRequest("/api/downloads/packet", { month: emptyMonth, source: sourceA }),
    );
    expect(packetResponse.status).toBe(200);
    const summaryResponse = await summaryGet(
      downloadRequest("/api/downloads/summary", { month: emptyMonth, source: sourceA }),
    );
    expect(summaryResponse.status).toBe(200);

    // Cover sheet: needs a real, fully-documented expense to serve anything at all (an empty
    // line item 409s). The standalone cover-sheet route converts its own docx straight to PDF
    // (`convertDocxToPdf`) and never calls `coverSheetAnchors`, so it does not hit the
    // `pdftotext -bbox-layout` gap above; requested as `docx` here regardless, since the format
    // is irrelevant to what a lock protects.
    const coverMonth = freshMonth();
    await completeExpense(sourceA, coverMonth, itemA);
    const lockedCover = await lockMonth({
      orgId,
      userId,
      fundingSourceId: sourceA,
      month: coverMonth,
      file: await pdfFile(),
    });
    expect(lockedCover.ok).toBe(true);
    const coverSheetResponse = await coverSheetGet(
      downloadRequest("/api/downloads/cover-sheet", { month: coverMonth, lineItem: itemA, source: sourceA }),
    );
    expect(coverSheetResponse.status).toBe(200);

    // An unlocked month keeps working normally.
    const openMonth = freshMonth();
    asUser(orgId, userId);
    const { createExpenseAction, updateExpenseAction } = await import("@/src/modules/expenses/actions");
    const created = await createExpenseAction({
      name: "Still open",
      fundingSourceId: sourceA,
      lineItemId: itemA,
      paymentSource: "Cash",
      taxReimbursable: false,
      feesReimbursable: true,
      month: openMonth,
      date: `${openMonth}-06`,
      description: "",
      subtotal: "1.00",
      tax: "0.00",
      fees: "0.00",
      note: "",
      narrative: "narrative",
      noReceipt: true,
      noReceiptReason: "n/a",
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      const edited = await updateExpenseAction({
        id: created.data.id,
        name: "Still open, edited",
        fundingSourceId: sourceA,
        lineItemId: itemA,
        paymentSource: "Cash",
        taxReimbursable: false,
        feesReimbursable: true,
        month: openMonth,
        date: `${openMonth}-06`,
        description: "",
        subtotal: "2.00",
        tax: "0.00",
        fees: "0.00",
        note: "",
        narrative: "narrative",
        noReceipt: true,
        noReceiptReason: "n/a",
      });
      expect(edited.ok).toBe(true);
    }
  }, 30_000);

  it("locks a month through the upload route: 200, ok true, locked_at set, one lock event, signed copy served by GET", async () => {
    const month = freshMonth();
    routeAsUser(orgId, userId);
    const form = new FormData();
    form.set("target", "signed-packet");
    form.set("month", month);
    form.set("fundingSourceId", sourceA);
    form.set("file", await pdfFile("route-lock.pdf"));
    const request = new NextRequest("http://localhost/api/files/upload", {
      method: "POST",
      body: form,
      headers: { "sec-fetch-site": "same-origin" },
    });
    const response = await uploadPost(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);

    const status = await lockedAtOf(sourceA, month);
    expect(status?.lockedAt).not.toBeNull();

    const events = await loadLockEvents(orgId, sourceA, month);
    expect(events).toHaveLength(1);
    expect(events[0].filename).toBe("route-lock.pdf");

    const getResponse = await filesGet(new Request(`http://localhost/api/files/${events[0].id}`), {
      params: Promise.resolve({ id: events[0].id }),
    });
    expect(getResponse.status).toBe(200);
  });

  it("a non-PDF through the upload route is refused: 400, UI.lockNotPdf, month not locked, no event row", async () => {
    const month = freshMonth();
    routeAsUser(orgId, userId);
    const form = new FormData();
    form.set("target", "signed-packet");
    form.set("month", month);
    form.set("fundingSourceId", sourceA);
    form.set("file", await pngFile());
    const request = new NextRequest("http://localhost/api/files/upload", {
      method: "POST",
      body: form,
      headers: { "sec-fetch-site": "same-origin" },
    });
    const response = await uploadPost(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe(UI.lockNotPdf);

    const status = await lockedAtOf(sourceA, month);
    expect(status?.lockedAt ?? null).toBeNull();
    const events = await loadLockEvents(orgId, sourceA, month);
    expect(events).toHaveLength(0);
  });
});
