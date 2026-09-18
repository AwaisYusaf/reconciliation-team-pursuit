/**
 * `loadOrgDirectory`, `loadOrgAccount`, `loadOrgUsers`, `loadOrgUsage`, `loadOrgHistory`
 * (Phase 9 part 3, `docs/PHASE-9.md` §5, §6). A two-org fixture (A and B), both populated with
 * data, so cross-org leakage is detectable rather than merely "no data present to leak".
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("admin queries (integration, Phase 9 part 3)", async () => {
  const { db } = await import("@/src/db");
  const {
    aiUsageEvents,
    expenseDocuments,
    expenses,
    fundingSources,
    generatedArtifacts,
    lineItems,
    monthDocuments,
    monthLockEvents,
    monthStatuses,
    orgAccountEvents,
    organizations,
    staffUsers,
    users,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { currentMonthKey } = await import("@/src/domain/dates");
  const { MAX_ORG_BYTES, orgStorageError } = await import("@/src/services/storage/documents");
  const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");
  const { describeAccountEvent } = await import("./directory");

  const {
    loadOrgAccount,
    loadOrgAiUsage,
    loadOrgDirectory,
    loadOrgHistory,
    loadOrgSummary,
    loadOrgUsage,
    loadOrgUsers,
    ORG_USERS_PREVIEW,
  } = await import("./queries");

  const currentMonth = currentMonthKey();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let orgA: string;
  let orgB: string;
  let sourceA1: string;
  let sourceA2: string;
  let sourceB: string;
  let lineItemA1: string;
  let lineItemB: string;
  let staffId: string;
  const orgIds: string[] = [];

  beforeAll(async () => {
    const a = await createTestOrg({ name: `Queries Org A ${unique}`, fundingSourceName: "A Source 1" });
    orgA = a.orgId;
    sourceA1 = a.fundingSourceId;
    orgIds.push(orgA);

    const b = await createTestOrg({ name: `Queries Org B ${unique}`, fundingSourceName: "B Source" });
    orgB = b.orgId;
    sourceB = b.fundingSourceId;
    orgIds.push(orgB);

    const [source2] = await db
      .insert(fundingSources)
      .values({ orgId: orgA, name: "A Source 2", type: "grant", sortOrder: 1, ...ORIGINAL_RULES })
      .returning({ id: fundingSources.id });
    sourceA2 = source2.id;

    const [itemA1] = await db
      .insert(lineItems)
      .values({ orgId: orgA, fundingSourceId: sourceA1, name: "Travel", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemA1 = itemA1.id;

    // A second line item on A's second funding source, so it can host expenses/documents too.
    await db
      .insert(lineItems)
      .values({ orgId: orgA, fundingSourceId: sourceA2, name: "Supplies", scheduledValueCents: 50_000, sortOrder: 0 });

    const [itemB] = await db
      .insert(lineItems)
      .values({ orgId: orgB, fundingSourceId: sourceB, name: "Travel", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemB = itemB.id;

    const [staff] = await db
      .insert(staffUsers)
      .values({
        email: `queries-staff-${unique}@example.test`,
        name: "Queries Staff",
        passwordHash: await hashPassword("irrelevant-password-1"),
      })
      .returning({ id: staffUsers.id });
    staffId = staff.id;
  }, 30_000);

  afterAll(async () => {
    for (const id of orgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
    if (staffId) await db.delete(staffUsers).where(eq(staffUsers.id, staffId));
  });

  function expenseValues(overrides: Partial<typeof expenses.$inferInsert> & { referenceSeq: number }) {
    return {
      orgId: orgA,
      fundingSourceId: sourceA1,
      lineItemId: lineItemA1,
      month: currentMonth,
      date: "2026-01-05",
      name: "Expense",
      paymentSource: "x",
      subtotalCents: 1000,
      sortOrder: 0,
      taxReimbursable: false,
      feesReimbursable: true,
      ...overrides,
    };
  }

  /* ----------------------------------------------------------------- loadOrgUsage */

  describe("loadOrgUsage", () => {
    it("a brand-new org with no data returns all zeros and a null lastExpenseAt", async () => {
      const fresh = await createTestOrg({ name: `Queries Fresh Org ${unique}` });
      orgIds.push(fresh.orgId);

      const usage = await loadOrgUsage(fresh.orgId);
      expect(usage).toEqual({
        fundingSourcesActive: 1, // createTestOrg's own funding source
        fundingSourcesArchived: 0,
        expensesTotal: 0,
        expensesCurrentMonth: 0,
        currentMonth,
        lastExpenseAt: null,
        storageBytes: 0,
        storageLimitBytes: MAX_ORG_BYTES,
        monthsSubmitted: 0,
        monthsLocked: 0,
        packetsDownloaded: 0,
      });
    });

    it("excludes soft-deleted expenses from totals, current-month count and lastExpenseAt", async () => {
      const base = new Date("2026-05-01T12:00:00Z");
      await db.insert(expenses).values([
        expenseValues({
          referenceSeq: 101,
          sortOrder: 101,
          createdAt: base,
        }),
        expenseValues({
          referenceSeq: 102,
          sortOrder: 102,
          createdAt: new Date(base.getTime() + 60_000),
        }),
        // The newest expense is deleted — lastExpenseAt must ignore it.
        expenseValues({
          referenceSeq: 103,
          sortOrder: 103,
          createdAt: new Date(base.getTime() + 120_000),
          deletedAt: new Date(base.getTime() + 180_000),
        }),
      ]);

      try {
        const usage = await loadOrgUsage(orgA);
        expect(usage.expensesTotal).toBe(2);
        // lastExpenseAt is typed Date | null (sql<Date | null>`max(...)`), so a real Date is
        // the contract — see the "lastExpenseAt is a real Date instance" note below.
        expect(usage.lastExpenseAt).toBeInstanceOf(Date);
        expect(usage.lastExpenseAt?.getTime()).toBe(base.getTime() + 60_000);
      } finally {
        await db.delete(expenses).where(eq(expenses.orgId, orgA));
      }
    });

    it("expensesCurrentMonth counts by expenses.month, not created_at (Q3)", async () => {
      await db.insert(expenses).values([
        expenseValues({ referenceSeq: 201, sortOrder: 201, month: currentMonth }),
        // created_at is "now" (default) but month is a past month — must not count as current.
        expenseValues({ referenceSeq: 202, sortOrder: 202, month: "2020-01" }),
      ]);

      try {
        const usage = await loadOrgUsage(orgA);
        expect(usage.expensesTotal).toBe(2);
        expect(usage.expensesCurrentMonth).toBe(1);
      } finally {
        await db.delete(expenses).where(eq(expenses.orgId, orgA));
      }
    });

    it("splits active vs archived funding sources by archived_at", async () => {
      await db.update(fundingSources).set({ archivedAt: new Date() }).where(eq(fundingSources.id, sourceA2));

      try {
        const usage = await loadOrgUsage(orgA);
        expect(usage.fundingSourcesActive).toBe(1);
        expect(usage.fundingSourcesArchived).toBe(1);
      } finally {
        await db.update(fundingSources).set({ archivedAt: null }).where(eq(fundingSources.id, sourceA2));
      }
    });

    it("monthsSubmitted and monthsLocked count month_statuses rows per funding source (Q4)", async () => {
      const month = "2026-06";
      const otherMonth = "2026-05";
      // The two counts must differ, or swapping the two `filter (where … is not null)` clauses
      // passes: a month that is submitted but not locked is the case that tells them apart,
      // and it is also the ordinary state of a month mid-reconciliation.
      await db.insert(monthStatuses).values([
        { orgId: orgA, fundingSourceId: sourceA1, month, submittedAt: new Date(), lockedAt: new Date() },
        { orgId: orgA, fundingSourceId: sourceA2, month, submittedAt: new Date(), lockedAt: new Date() },
        { orgId: orgA, fundingSourceId: sourceA1, month: otherMonth, submittedAt: new Date(), lockedAt: null },
      ]);

      try {
        const usage = await loadOrgUsage(orgA);
        expect(usage.monthsSubmitted).toBe(3);
        expect(usage.monthsLocked).toBe(2);
      } finally {
        await db
          .delete(monthStatuses)
          .where(
            and(
              eq(monthStatuses.orgId, orgA),
              inArray(monthStatuses.month, [month, otherMonth]),
            ),
          );
      }
    });

    it("packetsDownloaded counts only downloaded packet_pdf artifacts", async () => {
      const month = "2026-07";
      await db.insert(generatedArtifacts).values([
        {
          orgId: orgA,
          fundingSourceId: sourceA1,
          month,
          type: "packet_pdf",
          inputsHash: "hash-downloaded",
          downloadedAt: new Date(),
          s3Key: `org/${orgA}/downloaded.pdf`,
          sizeBytes: 100,
        },
        {
          orgId: orgA,
          fundingSourceId: sourceA1,
          month,
          type: "packet_pdf",
          inputsHash: "hash-not-downloaded",
          downloadedAt: null,
          s3Key: `org/${orgA}/not-downloaded.pdf`,
          sizeBytes: 100,
        },
        {
          orgId: orgA,
          fundingSourceId: sourceA1,
          month,
          type: "summary_xlsx",
          inputsHash: "hash-other-type",
          downloadedAt: new Date(),
          s3Key: `org/${orgA}/other-type.xlsx`,
          sizeBytes: 100,
        },
      ]);

      try {
        const usage = await loadOrgUsage(orgA);
        expect(usage.packetsDownloaded).toBe(1);
      } finally {
        await db
          .delete(generatedArtifacts)
          .where(and(eq(generatedArtifacts.orgId, orgA), eq(generatedArtifacts.month, month)));
      }
    });

    it("storageBytes equals the orgStorageError sum, and pins the equality against the quota path", async () => {
      const [expenseRow] = await db
        .insert(expenses)
        .values(expenseValues({ referenceSeq: 301, sortOrder: 301 }))
        .returning({ id: expenses.id });

      await db.insert(expenseDocuments).values({
        orgId: orgA,
        expenseId: expenseRow.id,
        kind: "proof",
        status: "attached",
        s3Key: `org/${orgA}/doc1`,
        filename: "doc1.png",
        mimeType: "image/png",
        sizeBytes: 1000,
        thumbnailBytes: 200,
        sortOrder: 0,
      });
      await db.insert(monthDocuments).values({
        orgId: orgA,
        fundingSourceId: sourceA1,
        month: currentMonth,
        category: "bank_statement",
        status: "attached",
        s3Key: `org/${orgA}/monthdoc1`,
        filename: "bank.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3000,
        thumbnailBytes: 0,
        sortOrder: 0,
      });
      await db.insert(monthLockEvents).values({
        orgId: orgA,
        fundingSourceId: sourceA1,
        month: currentMonth,
        s3Key: `org/${orgA}/lock1`,
        filename: "signed.pdf",
        sizeBytes: 5000,
      });

      try {
        const expectedTotal = 1000 + 200 + 3000 + 5000;
        const usage = await loadOrgUsage(orgA);
        expect(usage.storageBytes).toBe(expectedTotal);
        expect(usage.storageLimitBytes).toBe(MAX_ORG_BYTES);

        expect(await orgStorageError(db, orgA, MAX_ORG_BYTES - usage.storageBytes)).toBeNull();
        expect(await orgStorageError(db, orgA, MAX_ORG_BYTES - usage.storageBytes + 1)).not.toBeNull();
      } finally {
        await db.delete(expenseDocuments).where(eq(expenseDocuments.orgId, orgA));
        await db.delete(monthDocuments).where(eq(monthDocuments.orgId, orgA));
        await db.delete(monthLockEvents).where(eq(monthLockEvents.orgId, orgA));
        await db.delete(expenses).where(eq(expenses.orgId, orgA));
      }
    });

    it("never includes org B's rows", async () => {
      // Populate B with its own, different, data.
      const [bItem] = await db
        .insert(expenses)
        .values({
          orgId: orgB,
          fundingSourceId: sourceB,
          lineItemId: lineItemB,
          month: currentMonth,
          date: "2026-01-05",
          name: "B Expense",
          paymentSource: "x",
          subtotalCents: 5000,
          sortOrder: 0,
          referenceSeq: 1,
          taxReimbursable: false,
          feesReimbursable: true,
        })
        .returning({ id: expenses.id });

      await db.insert(expenseDocuments).values({
        orgId: orgB,
        expenseId: bItem.id,
        kind: "proof",
        status: "attached",
        s3Key: `org/${orgB}/bdoc`,
        filename: "b.png",
        mimeType: "image/png",
        sizeBytes: 999_999,
        sortOrder: 0,
      });
      await db.insert(monthStatuses).values({
        orgId: orgB,
        fundingSourceId: sourceB,
        month: currentMonth,
        submittedAt: new Date(),
        lockedAt: new Date(),
      });
      await db.insert(generatedArtifacts).values({
        orgId: orgB,
        fundingSourceId: sourceB,
        month: currentMonth,
        type: "packet_pdf",
        inputsHash: "b-hash",
        downloadedAt: new Date(),
        s3Key: `org/${orgB}/packet.pdf`,
        sizeBytes: 100,
      });

      try {
        // A is untouched by any of the above.
        const usageA = await loadOrgUsage(orgA);
        expect(usageA.expensesTotal).toBe(0);
        expect(usageA.storageBytes).toBe(0);
        expect(usageA.monthsSubmitted).toBe(0);
        expect(usageA.packetsDownloaded).toBe(0);

        // B shows its own numbers.
        const usageB = await loadOrgUsage(orgB);
        expect(usageB.expensesTotal).toBe(1);
        expect(usageB.storageBytes).toBe(999_999);
        expect(usageB.monthsSubmitted).toBe(1);
        expect(usageB.monthsLocked).toBe(1);
        expect(usageB.packetsDownloaded).toBe(1);
      } finally {
        await db.delete(expenseDocuments).where(eq(expenseDocuments.orgId, orgB));
        await db.delete(monthStatuses).where(eq(monthStatuses.orgId, orgB));
        await db.delete(generatedArtifacts).where(eq(generatedArtifacts.orgId, orgB));
        await db.delete(expenses).where(eq(expenses.orgId, orgB));
      }
    });

    it("returns the zeroed usage without throwing for a non-uuid orgId", async () => {
      const usage = await loadOrgUsage("not-a-uuid");
      expect(usage.storageLimitBytes).toBe(MAX_ORG_BYTES);
      expect(usage.currentMonth).toBe(currentMonth);
      expect(usage.expensesTotal).toBe(0);
      expect(usage.storageBytes).toBe(0);
      expect(usage.lastExpenseAt).toBeNull();
    });
  });

  /* -------------------------------------------------------------- loadOrgDirectory */

  describe("loadOrgDirectory", () => {
    it("contains both orgs exactly once, userCount is a number (0 for no users), lastSignInAt is a max Date or null, newest first", async () => {
      await db
        .insert(users)
        .values({ orgId: orgA, email: `a-user1-${unique}@example.test`, passwordHash: "x", role: "admin", lastSignInAt: new Date("2026-01-01T00:00:00Z") })
        .returning({ id: users.id });
      await db
        .insert(users)
        .values({ orgId: orgA, email: `a-user2-${unique}@example.test`, passwordHash: "x", role: "manager", lastSignInAt: new Date("2026-02-01T00:00:00Z") })
        .returning({ id: users.id });
      // orgB has no users at all — proves the LEFT JOIN.

      try {
        const { rows } = await loadOrgDirectory({}, 1, 1000);
        const aRows = rows.filter((r) => r.id === orgA);
        const bRows = rows.filter((r) => r.id === orgB);
        expect(aRows).toHaveLength(1);
        expect(bRows).toHaveLength(1);

        expect(aRows[0].userCount).toBe(2);
        expect(typeof aRows[0].userCount).toBe("number");
        // The row type is `Date | null` (sql<Date | null>`max(...)`) — assert the real
        // runtime type rather than trusting the annotation.
        expect(aRows[0].lastSignInAt).toBeInstanceOf(Date);
        expect(aRows[0].lastSignInAt?.toISOString()).toBe("2026-02-01T00:00:00.000Z");

        expect(bRows[0].userCount).toBe(0);
        expect(bRows[0].lastSignInAt).toBeNull();

        // Newest created_at first, across the whole directory.
        const created = rows.map((r) => r.createdAt.getTime());
        const sorted = [...created].sort((a, b) => b - a);
        expect(created).toEqual(sorted);
      } finally {
        await db.delete(users).where(eq(users.orgId, orgA));
      }
    });
  });

  /* ------------------------------------- server-side search, filters and pagination */

  describe("loadOrgDirectory: filtering and paging happen in SQL, not in the browser", () => {
    // 25 organizations, more than two pages. The point of every assertion below is that a
    // match on page 3 is found by a search run on page 1 — the client-side version could only
    // ever narrow the rows already fetched, so a search found nothing unless it was on screen.
    const ids: string[] = [];
    const prefix = `Paged ${unique}`;
    let needleId: string;

    beforeAll(async () => {
      for (let i = 0; i < 25; i++) {
        const [org] = await db
          .insert(organizations)
          .values({
            name: `${prefix} Org ${String(i).padStart(2, "0")}`,
            docName: "Paged",
            activeMonth: "2026-02",
            // Distinct, ascending creation times so "newest first" is deterministic.
            createdAt: new Date(Date.UTC(2026, 0, i + 1)),
            plan: i % 5 === 0 ? "reconciliation_ai" : "reconciliation",
            subscriptionStatus: i % 4 === 0 ? "past_due" : "trial",
            complimentary: i % 3 === 0,
            suspendedAt: i % 10 === 0 ? new Date() : null,
          })
          .returning({ id: organizations.id });
        ids.push(org.id);
      }

      // The needle is the OLDEST, so it lands on the last page and can never be on page 1.
      const [needle] = await db
        .insert(organizations)
        .values({
          name: `${prefix} Zzz Needle Organization`,
          docName: "Needle",
          activeMonth: "2026-02",
          createdAt: new Date(Date.UTC(2025, 0, 1)),
        })
        .returning({ id: organizations.id });
      needleId = needle.id;
      ids.push(needle.id);
    });

    afterAll(async () => {
      for (const id of ids) await db.delete(organizations).where(eq(organizations.id, id));
    });

    it("returns one page at a time, with the real total and page count", async () => {
      const first = await loadOrgDirectory({ search: prefix }, 1, 10);
      expect(first.rows).toHaveLength(10);
      expect(first.total).toBe(26);
      expect(first.pageCount).toBe(3);
      expect(first.page).toBe(1);

      const last = await loadOrgDirectory({ search: prefix }, 3, 10);
      expect(last.rows).toHaveLength(6);
      expect(last.page).toBe(3);

      // No organization appears on two pages, and every one appears somewhere.
      const second = await loadOrgDirectory({ search: prefix }, 2, 10);
      const seen = [...first.rows, ...second.rows, ...last.rows].map((r) => r.id);
      expect(new Set(seen).size).toBe(26);
    });

    it("finds a match that is not on the first page", async () => {
      const page1 = await loadOrgDirectory({ search: prefix }, 1, 10);
      expect(page1.rows.map((r) => r.id)).not.toContain(needleId);

      const found = await loadOrgDirectory({ search: "Zzz Needle" }, 1, 10);
      expect(found.total).toBe(1);
      expect(found.rows.map((r) => r.id)).toEqual([needleId]);
    });

    it("search is case-insensitive, trims, and matches mid-name", async () => {
      for (const term of ["zzz needle", "  Zzz Needle  ", "Needle Organization"]) {
        const result = await loadOrgDirectory({ search: term }, 1, 10);
        expect(result.rows.map((r) => r.id)).toEqual([needleId]);
      }
    });

    it("treats % and _ in a search as characters, not wildcards", async () => {
      // Unescaped, "%" matches every row — the search box would silently return everything.
      const result = await loadOrgDirectory({ search: "%" }, 1, 10);
      expect(result.total).toBe(0);
      const underscore = await loadOrgDirectory({ search: "_" }, 1, 10);
      expect(underscore.total).toBe(0);
    });

    it("filters by plan, status and each badge, with the counts the fixture defines", async () => {
      // Counted from the loop above over the 25 generated rows: plan every 5th, status every
      // 4th, complimentary every 3rd, suspended every 10th. The needle has the defaults.
      const ai = await loadOrgDirectory({ search: prefix, plan: "reconciliation_ai" }, 1, 100);
      expect(ai.total).toBe(5); // i = 0, 5, 10, 15, 20

      const pastDue = await loadOrgDirectory({ search: prefix, status: "past_due" }, 1, 100);
      expect(pastDue.total).toBe(7); // i = 0, 4, 8, 12, 16, 20, 24

      const complimentary = await loadOrgDirectory({ search: prefix, badge: "complimentary" }, 1, 100);
      expect(complimentary.total).toBe(9); // i = 0, 3, 6, 9, 12, 15, 18, 21, 24

      const suspended = await loadOrgDirectory({ search: prefix, badge: "suspended" }, 1, 100);
      expect(suspended.total).toBe(3); // i = 0, 10, 20
      expect(suspended.rows.every((r) => r.suspendedAt !== null)).toBe(true);
    });

    it("combines filters with AND, and pages the combined result", async () => {
      const both = await loadOrgDirectory(
        { search: prefix, plan: "reconciliation_ai", status: "past_due" },
        1,
        100,
      );
      expect(both.total).toBe(2); // plan every 5th ∩ status every 4th = i = 0, 20
      expect(both.rows.every((r) => r.plan === "reconciliation_ai")).toBe(true);
      expect(both.rows.every((r) => r.subscriptionStatus === "past_due")).toBe(true);
    });

    it("orders newest signup first, across page boundaries", async () => {
      const first = await loadOrgDirectory({ search: prefix }, 1, 10);
      const second = await loadOrgDirectory({ search: prefix }, 2, 10);
      const times = [...first.rows, ...second.rows].map((r) => r.createdAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
      // The last row of page 1 is newer than the first row of page 2 — no overlap, no gap.
      expect(first.rows.at(-1)!.createdAt.getTime()).toBeGreaterThanOrEqual(
        second.rows[0].createdAt.getTime(),
      );
    });

    it("a page past the end clamps to the last page rather than returning nothing", async () => {
      const beyond = await loadOrgDirectory({ search: prefix }, 99, 10);
      expect(beyond.page).toBe(3);
      expect(beyond.rows).toHaveLength(6);
    });

    it("page 0 and a nonsense page are treated as page 1", async () => {
      for (const page of [0, -3, Number.NaN]) {
        const result = await loadOrgDirectory({ search: prefix }, page, 10);
        expect(result.page).toBe(1);
        expect(result.rows).toHaveLength(10);
      }
    });

    it("loadOrgSummary puts every organization in exactly the right bucket", async () => {
      // Both sides are read inside ONE repeatable-read snapshot, so sibling test files
      // committing to `organizations` while this runs cannot move either number — a delta
      // across two ordinary reads is flaky here no matter how small the window.
      //
      // The expected side is counted in JS from the rows themselves, deliberately NOT with a
      // second copy of the same `count(*) filter (…)` SQL: comparing the query against itself
      // is the mistake that let the old summary tests pass while trial and active were
      // swapped, the two plans were swapped, the complimentary filter was dropped and the
      // suspended one inverted — the numbers AB Solutions reads at a glance, none protected.
      await db.transaction(
        async (tx) => {
          const summary = await loadOrgSummary(tx);
          const rows = await tx
            .select({
              plan: organizations.plan,
              subscriptionStatus: organizations.subscriptionStatus,
              complimentary: organizations.complimentary,
              suspendedAt: organizations.suspendedAt,
            })
            .from(organizations);

          const count = (predicate: (r: (typeof rows)[number]) => boolean) => rows.filter(predicate).length;

          expect(summary.plan.reconciliation).toBe(count((r) => r.plan === "reconciliation"));
          expect(summary.plan.reconciliation_ai).toBe(count((r) => r.plan === "reconciliation_ai"));
          expect(summary.status.trial).toBe(count((r) => r.subscriptionStatus === "trial"));
          expect(summary.status.active).toBe(count((r) => r.subscriptionStatus === "active"));
          expect(summary.status.past_due).toBe(count((r) => r.subscriptionStatus === "past_due"));
          expect(summary.status.cancelled).toBe(count((r) => r.subscriptionStatus === "cancelled"));
          expect(summary.complimentary).toBe(count((r) => r.complimentary));
          expect(summary.suspended).toBe(count((r) => r.suspendedAt !== null));

          // The fixture guarantees each bucket is non-empty and no two are equal by accident,
          // so a swap between any pair is a real difference rather than 0 === 0.
          expect(summary.plan.reconciliation_ai).toBeGreaterThanOrEqual(5);
          expect(summary.status.past_due).toBeGreaterThanOrEqual(7);
          expect(summary.complimentary).toBeGreaterThanOrEqual(9);
          expect(summary.suspended).toBeGreaterThanOrEqual(3);
        },
        { isolationLevel: "repeatable read" },
      );
    });

    it("the summary ignores the filter and the page being shown", async () => {
      // A one-row page of the narrowest filter on the fixture, then the summary: it still
      // counts this fixture's 3 suspended and 9 complimentary rows, which are spread across
      // all three pages.
      const narrow = await loadOrgDirectory({ search: prefix, badge: "suspended" }, 1, 1);
      expect(narrow.rows).toHaveLength(1);
      expect(narrow.total).toBe(3);

      const summary = await loadOrgSummary();
      const fixtureSuspended = await loadOrgDirectory({ search: prefix, badge: "suspended" }, 1, 100);
      const fixtureComplimentary = await loadOrgDirectory({ search: prefix, badge: "complimentary" }, 1, 100);
      expect(summary.suspended).toBeGreaterThanOrEqual(fixtureSuspended.total);
      expect(summary.complimentary).toBeGreaterThanOrEqual(fixtureComplimentary.total);
      expect(fixtureSuspended.total).toBe(3);
      expect(fixtureComplimentary.total).toBe(9);
    });

    it("pages stably when two organizations share a created_at (the id tiebreak)", async () => {
      // Without `organizations.id` in the ORDER BY, rows with an identical timestamp can be
      // returned in a different order per query — one of them then appears on both pages, or
      // on neither, and is invisible in the directory.
      const tiePrefix = `Tie ${unique}`;
      const sameMoment = new Date(Date.UTC(2026, 5, 15, 12, 0, 0));
      const tieIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const [org] = await db
          .insert(organizations)
          .values({
            name: `${tiePrefix} ${i}`,
            docName: "Tie",
            activeMonth: "2026-02",
            createdAt: sameMoment,
          })
          .returning({ id: organizations.id });
        tieIds.push(org.id);
      }

      try {
        const page1 = await loadOrgDirectory({ search: tiePrefix }, 1, 2);
        const page2 = await loadOrgDirectory({ search: tiePrefix }, 2, 2);
        const seen = [...page1.rows, ...page2.rows].map((r) => r.id);
        expect(seen).toHaveLength(3);
        expect(new Set(seen).size).toBe(3);
        expect([...seen].sort()).toEqual([...tieIds].sort());
      } finally {
        for (const id of tieIds) await db.delete(organizations).where(eq(organizations.id, id));
      }
    });
  });

  /* ---------------------------------------------------------------- loadOrgAiUsage */

  describe("loadOrgAiUsage (Phase 11 follow-up, D-107 AI usage card)", () => {
    let aiOrgId: string;
    let aiSourceId: string;

    /** The UTC instant that is exactly local midnight on the 1st of `monthKey` in
     *  America/Detroit — computed deliberately (not assumed), trying both possible DST offsets
     *  (-4 EDT / -5 EST) and keeping whichever actually round-trips through Intl. */
    function detroitMonthStartUtc(monthKey: string): Date {
      const [year, month] = monthKey.split("-").map(Number);
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Detroit",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      for (const offsetHours of [4, 5]) {
        const candidate = new Date(Date.UTC(year, month - 1, 1, offsetHours, 0, 0, 0));
        const parts = Object.fromEntries(fmt.formatToParts(candidate).map((p) => [p.type, p.value]));
        const hour = parts.hour === "24" ? "00" : parts.hour;
        if (
          parts.year === String(year) &&
          parts.month === String(month).padStart(2, "0") &&
          parts.day === "01" &&
          hour === "00" &&
          parts.minute === "00"
        ) {
          return candidate;
        }
      }
      throw new Error(`could not compute Detroit month boundary for ${monthKey}`);
    }

    beforeAll(async () => {
      const org = await createTestOrg({ name: `AI Usage Org ${unique}` });
      aiOrgId = org.orgId;
      aiSourceId = org.fundingSourceId;
      orgIds.push(aiOrgId);
    });

    afterEach(async () => {
      await db.delete(aiUsageEvents).where(eq(aiUsageEvents.orgId, aiOrgId));
    });

    it("counts land in the reads bucket for amount_read and the summaries bucket for monthly_summary, unsaved counts failed+rejected per feature, and the total cost is the real sum", async () => {
      await db.insert(aiUsageEvents).values([
        {
          orgId: aiOrgId,
          feature: "amount_read",
          outcome: "found",
          model: "test",
          documentSource: "upload",
          documentKind: "receipt",
          inputTokens: 100,
          outputTokens: 20,
          costMicroUsd: 500,
        },
        {
          orgId: aiOrgId,
          feature: "amount_read",
          outcome: "failed",
          model: "test",
          documentSource: "upload",
          documentKind: "proof",
        },
        {
          orgId: aiOrgId,
          feature: "monthly_summary",
          outcome: "success",
          model: "test",
          fundingSourceId: aiSourceId,
          month: currentMonth,
          trigger: "first",
          inputTokens: 1000,
          outputTokens: 200,
          costMicroUsd: 5000,
        },
        {
          orgId: aiOrgId,
          feature: "monthly_summary",
          outcome: "rejected",
          model: "test",
          fundingSourceId: aiSourceId,
          month: currentMonth,
          trigger: "again",
          inputTokens: 500,
          outputTokens: 100,
          costMicroUsd: 2000,
        },
      ]);

      const usage = await loadOrgAiUsage(aiOrgId);
      expect(usage.reads).toEqual({ total: 2, currentMonth: 2, unsaved: 1 });
      expect(usage.summaries).toEqual({ total: 2, currentMonth: 2, unsaved: 1 });
      expect(usage.costMicroUsdTotal).toBe(500 + 5000 + 2000); // the failed row's null cost adds nothing
      expect(usage.lastRunAt).toBeInstanceOf(Date);
    });

    it("Detroit month boundary: the instant just before local midnight on the 1st is still the previous month; the exact boundary instant is this month", async () => {
      const boundary = detroitMonthStartUtc(currentMonth);
      const justBefore = new Date(boundary.getTime() - 1);

      await db.insert(aiUsageEvents).values({
        orgId: aiOrgId,
        feature: "amount_read",
        outcome: "found",
        model: "test",
        documentSource: "upload",
        documentKind: "receipt",
        createdAt: justBefore,
      });
      const beforeUsage = await loadOrgAiUsage(aiOrgId);
      expect(beforeUsage.reads.total).toBe(1);
      expect(beforeUsage.reads.currentMonth).toBe(0); // one millisecond too early — previous month

      await db.insert(aiUsageEvents).values({
        orgId: aiOrgId,
        feature: "amount_read",
        outcome: "found",
        model: "test",
        documentSource: "upload",
        documentKind: "receipt",
        createdAt: boundary,
      });
      const afterUsage = await loadOrgAiUsage(aiOrgId);
      expect(afterUsage.reads.total).toBe(2);
      expect(afterUsage.reads.currentMonth).toBe(1); // exactly the boundary instant — this month
    });

    it("costIncomplete is true only when a row has tokens but no cost (missing price settings)", async () => {
      await db.insert(aiUsageEvents).values({
        orgId: aiOrgId,
        feature: "amount_read",
        outcome: "found",
        model: "test",
        documentSource: "upload",
        documentKind: "receipt",
        inputTokens: 100,
        outputTokens: 20,
        costMicroUsd: null,
      });
      const usage = await loadOrgAiUsage(aiOrgId);
      expect(usage.costIncomplete).toBe(true);
    });

    it("costIncomplete stays false when the only null-cost rows are failed runs with null tokens too", async () => {
      await db.insert(aiUsageEvents).values([
        {
          orgId: aiOrgId,
          feature: "amount_read",
          outcome: "failed",
          model: "test",
          documentSource: "upload",
          documentKind: "receipt",
          inputTokens: null,
          outputTokens: null,
          costMicroUsd: null,
        },
        {
          orgId: aiOrgId,
          feature: "monthly_summary",
          outcome: "failed",
          model: "test",
          fundingSourceId: aiSourceId,
          month: currentMonth,
          trigger: "first",
          inputTokens: null,
          outputTokens: null,
          costMicroUsd: null,
        },
      ]);
      const usage = await loadOrgAiUsage(aiOrgId);
      expect(usage.costIncomplete).toBe(false);
      expect(usage.reads.unsaved).toBe(1);
      expect(usage.summaries.unsaved).toBe(1);
    });

    it("returns the zeroed usage without throwing for a non-uuid org id", async () => {
      await expect(loadOrgAiUsage("not-a-uuid")).resolves.toEqual({
        currentMonth,
        reads: { total: 0, currentMonth: 0, unsaved: 0 },
        summaries: { total: 0, currentMonth: 0, unsaved: 0 },
        costMicroUsdTotal: 0,
        costMicroUsdCurrentMonth: 0,
        costIncomplete: false,
        lastRunAt: null,
      });
    });

    it("ai_usage_feature is a closed Postgres enum: an unrecognised feature value is refused by the database itself, never silently counted", async () => {
      // Cannot ALTER TYPE on the shared dev database to add a throwaway value, and the enum has
      // only 'amount_read'/'monthly_summary' — so this proves the guarantee at its real source:
      // the database refuses a row Drizzle's own types wouldn't even let this file compile with.
      // That refusal, together with `loadOrgAiUsage`'s explicit `else if (feature ===
      // "monthly_summary")` (never a bare `else`), is what keeps a feature added in the future
      // from being silently folded into the summaries tile.
      const error = await db
        .execute(
          sql`insert into ai_usage_events (org_id, feature, outcome, model, document_source, document_kind)
              values (${aiOrgId}, 'unknown_feature', 'found', 'test', 'upload', 'receipt')`,
        )
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(error).not.toBeNull();
      expect(String((error as { cause?: unknown })?.cause ?? error)).toMatch(
        /invalid input value for enum ai_usage_feature/i,
      );
    });
  });

  /* ----------------------------------------------------------------- loadOrgAccount */

  describe("loadOrgAccount", () => {
    it("returns the account fields for a real org", async () => {
      const account = await loadOrgAccount(orgA);
      expect(account?.id).toBe(orgA);
      expect(account?.plan).toBe("reconciliation");
    });

    it("returns null for an absent-but-valid uuid", async () => {
      expect(await loadOrgAccount("00000000-0000-7000-8000-000000000000")).toBeNull();
    });

    it("returns null for a non-uuid, without throwing", async () => {
      await expect(loadOrgAccount("not-a-uuid")).resolves.toBeNull();
    });
  });

  /* ------------------------------------------------------------------- loadOrgUsers */

  describe("loadOrgUsers", () => {
    it("returns only that org's users, oldest first, with role and lastSignInAt", async () => {
      const t0 = new Date("2026-01-01T00:00:00Z");
      const t1 = new Date("2026-01-02T00:00:00Z");
      await db.insert(users).values([
        { orgId: orgA, email: `u1-${unique}@example.test`, passwordHash: "x", role: "admin", createdAt: t0 },
        { orgId: orgA, email: `u2-${unique}@example.test`, passwordHash: "x", role: "manager", createdAt: t1, lastSignInAt: t1 },
      ]);
      await db.insert(users).values({ orgId: orgB, email: `ub-${unique}@example.test`, passwordHash: "x", role: "admin" });

      try {
        const { rows } = await loadOrgUsers(orgA);
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.email)).toEqual([`u1-${unique}@example.test`, `u2-${unique}@example.test`]);
        expect(rows[0].role).toBe("admin");
        expect(rows[1].lastSignInAt).toBeInstanceOf(Date);
        expect(rows[1].lastSignInAt?.toISOString()).toBe(t1.toISOString());
        expect(rows.some((r) => r.email.includes("ub-"))).toBe(false);
      } finally {
        await db.delete(users).where(eq(users.orgId, orgA));
        await db.delete(users).where(eq(users.orgId, orgB));
      }
    });

    it("returns no rows for a non-uuid and for an absent orgId, without throwing", async () => {
      await expect(loadOrgUsers("not-a-uuid")).resolves.toEqual({ rows: [], total: 0 });
      await expect(loadOrgUsers("00000000-0000-7000-8000-000000000000")).resolves.toEqual({
        rows: [],
        total: 0,
      });
    });

    it("shows only the first ten users by default, with the real total, and all of them on request", async () => {
      // The page used to render every user an organization had. The cap is applied in SQL, so
      // the rows past it are never fetched, and `total` is what the "View all" line counts.
      const many = Array.from({ length: 13 }, (_, i) => ({
        orgId: orgB,
        email: `many-${i}-${unique}@example.test`,
        passwordHash: "x",
        role: "manager" as const,
        createdAt: new Date(Date.UTC(2026, 0, i + 1)),
      }));
      await db.insert(users).values(many);

      try {
        const preview = await loadOrgUsers(orgB);
        expect(preview.rows).toHaveLength(ORG_USERS_PREVIEW);
        expect(preview.total).toBe(13);
        // Oldest first, so the preview is the first ten created.
        expect(preview.rows.map((r) => r.email)).toEqual(many.slice(0, 10).map((u) => u.email));

        const all = await loadOrgUsers(orgB, true);
        expect(all.rows).toHaveLength(13);
        expect(all.total).toBe(13);
      } finally {
        await db.delete(users).where(eq(users.orgId, orgB));
      }
    });
  });

  /* ----------------------------------------------------------------- loadOrgHistory */

  describe("loadOrgHistory", () => {
    const snapshot = (over: Partial<Record<string, unknown>> = {}) => ({
      plan: "reconciliation" as const,
      status: "trial" as const,
      complimentary: false,
      complimentaryUntil: null,
      suspended: false,
      ...over,
    });

    it("A's events come back newest first, scoped to A only, with before/after as objects", async () => {
      const t0 = new Date("2026-03-01T00:00:00Z");
      const t1 = new Date("2026-03-02T00:00:00Z");
      await db.insert(orgAccountEvents).values([
        {
          orgId: orgA,
          actorStaffId: staffId,
          action: "suspended",
          before: snapshot(),
          after: snapshot({ suspended: true }),
          createdAt: t0,
        },
        {
          orgId: orgA,
          actorStaffId: staffId,
          action: "reinstated",
          before: snapshot({ suspended: true }),
          after: snapshot(),
          createdAt: t1,
        },
      ]);
      await db.insert(orgAccountEvents).values({
        orgId: orgB,
        actorStaffId: staffId,
        action: "suspended",
        before: snapshot(),
        after: snapshot({ suspended: true }),
      });

      try {
        const rows = await loadOrgHistory(orgA);
        expect(rows).toHaveLength(2);
        expect(rows[0].action).toBe("reinstated"); // newest first
        expect(rows[1].action).toBe("suspended");
        expect(typeof rows[0].before).toBe("object");
        expect(rows[0].before).toEqual(snapshot({ suspended: true }));
        expect(rows.every((r) => r.actorEmail !== null)).toBe(true);
      } finally {
        await db.delete(orgAccountEvents).where(eq(orgAccountEvents.orgId, orgA));
        await db.delete(orgAccountEvents).where(eq(orgAccountEvents.orgId, orgB));
      }
    });

    it("a deleted staff account's event still returns with actorName/actorEmail null, and renders 'Unknown'", async () => {
      const [tempStaff] = await db
        .insert(staffUsers)
        .values({
          email: `temp-staff-${unique}@example.test`,
          name: "Temp Staff",
          passwordHash: await hashPassword("irrelevant-password-1"),
        })
        .returning({ id: staffUsers.id });

      await db.insert(orgAccountEvents).values({
        orgId: orgA,
        actorStaffId: tempStaff.id,
        action: "suspended",
        before: snapshot(),
        after: snapshot({ suspended: true }),
      });

      await db.delete(staffUsers).where(eq(staffUsers.id, tempStaff.id));

      const rows = await loadOrgHistory(orgA);
      expect(rows).toHaveLength(1);
      expect(rows[0].actorName).toBeNull();
      expect(rows[0].actorEmail).toBeNull();
      expect(describeAccountEvent(rows[0])).toBe("Unknown suspended access");

      await db.delete(orgAccountEvents).where(eq(orgAccountEvents.orgId, orgA));
    });

    it("returns [] for a non-uuid, without throwing", async () => {
      await expect(loadOrgHistory("not-a-uuid")).resolves.toEqual([]);
    });
  });
});
