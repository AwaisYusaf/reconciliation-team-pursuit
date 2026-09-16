/**
 * `loadOrgDirectory`, `loadOrgAccount`, `loadOrgUsers`, `loadOrgUsage`, `loadOrgHistory`
 * (Phase 9 part 3, `docs/PHASE-9.md` §5, §6). A two-org fixture (A and B), both populated with
 * data, so cross-org leakage is detectable rather than merely "no data present to leak".
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("admin queries (integration, Phase 9 part 3)", async () => {
  const { db } = await import("@/src/db");
  const {
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
    loadOrgDirectory,
    loadOrgHistory,
    loadOrgUsage,
    loadOrgUsers,
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
      await db.insert(monthStatuses).values([
        { orgId: orgA, fundingSourceId: sourceA1, month, submittedAt: new Date(), lockedAt: new Date() },
        { orgId: orgA, fundingSourceId: sourceA2, month, submittedAt: new Date(), lockedAt: new Date() },
      ]);

      try {
        const usage = await loadOrgUsage(orgA);
        expect(usage.monthsSubmitted).toBe(2);
        expect(usage.monthsLocked).toBe(2);
      } finally {
        await db.delete(monthStatuses).where(and(eq(monthStatuses.orgId, orgA), eq(monthStatuses.month, month)));
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
        const rows = await loadOrgDirectory();
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
        const rows = await loadOrgUsers(orgA);
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

    it("returns [] for a non-uuid and for an absent orgId, without throwing", async () => {
      await expect(loadOrgUsers("not-a-uuid")).resolves.toEqual([]);
      await expect(loadOrgUsers("00000000-0000-7000-8000-000000000000")).resolves.toEqual([]);
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
