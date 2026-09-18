/**
 * Integration tests for `loadReadySummarySourceIds` (Phase 11 §7.5, Dashboard batching) against
 * a real Postgres. Skipped when DATABASE_URL is absent, same convention as
 * `queries.integration.test.ts`.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const MONTH = "2098-05"; // far future, avoids clashing with real data
const OTHER_MONTH = "2098-06";

describe.skipIf(!hasDatabase)("loadReadySummarySourceIds (integration, Phase 11)", async () => {
  const { db } = await import("@/src/db");
  const { fundingSources, organizations, monthlySummaries } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");
  const { loadReadySummarySourceIds } = await import("./queries");

  let orgId: string;
  let sourceAId: string; // summary in MONTH
  let sourceBId: string; // summary in OTHER_MONTH only
  let sourceCId: string; // no summary at all
  let otherOrgId: string;
  let otherOrgSourceId: string; // has a summary in MONTH, but belongs to another org

  function summaryRow(
    fundingSourceId: string,
    month: string,
    overrides: Partial<typeof monthlySummaries.$inferInsert> = {},
  ) {
    return {
      orgId,
      fundingSourceId,
      month,
      contentMarkdown: "content",
      expensesFingerprint: "0".repeat(64),
      writtenAt: new Date(),
      model: "gpt-5.6-terra",
      ...overrides,
    };
  }

  async function addSource(name: string) {
    const [row] = await db
      .insert(fundingSources)
      .values({ orgId, name, type: "grant", sortOrder: 0, ...ORIGINAL_RULES })
      .returning({ id: fundingSources.id });
    return row.id;
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Ready Summary Ids Org", activeMonth: MONTH });
    orgId = org.orgId;
    sourceAId = org.fundingSourceId; // reuse the source createTestOrg already made
    sourceBId = await addSource("Source B");
    sourceCId = await addSource("Source C");
    await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, orgId));

    await db.insert(monthlySummaries).values(summaryRow(sourceAId, MONTH));
    await db.insert(monthlySummaries).values(summaryRow(sourceBId, OTHER_MONTH));

    const other = await createTestOrg({ name: "Ready Summary Ids Other Org", activeMonth: MONTH });
    otherOrgId = other.orgId;
    otherOrgSourceId = other.fundingSourceId;
    await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, otherOrgId));
    await db
      .insert(monthlySummaries)
      .values({ ...summaryRow(otherOrgSourceId, MONTH), orgId: otherOrgId });
  }, 30_000);

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      if (!id) continue;
      await db.delete(organizations).where(eq(organizations.id, id));
      await rm(path.join(process.cwd(), ".storage", "org", id), { recursive: true, force: true });
    }
  });

  it("returns only the ids with a summary in this exact month", async () => {
    const result = await loadReadySummarySourceIds(orgId, [sourceAId, sourceBId, sourceCId], MONTH);
    expect(result).toEqual(new Set([sourceAId]));
  });

  it("a source with a summary in a different month is not included", async () => {
    const result = await loadReadySummarySourceIds(orgId, [sourceBId], MONTH);
    expect(result.has(sourceBId)).toBe(false);
    const resultOtherMonth = await loadReadySummarySourceIds(orgId, [sourceBId], OTHER_MONTH);
    expect(resultOtherMonth.has(sourceBId)).toBe(true);
  });

  it("base plan (plan downgrade): empty Set even with a real summary present, no query against summaries", async () => {
    await db.update(organizations).set({ plan: "reconciliation" }).where(eq(organizations.id, orgId));
    try {
      const result = await loadReadySummarySourceIds(orgId, [sourceAId], MONTH);
      expect(result).toEqual(new Set());
    } finally {
      await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, orgId));
    }
  });

  it("another org's source id, even with a real summary, is never returned when passed under this org", async () => {
    const result = await loadReadySummarySourceIds(orgId, [otherOrgSourceId], MONTH);
    expect(result).toEqual(new Set());
  });

  it("empty list: empty Set", async () => {
    expect(await loadReadySummarySourceIds(orgId, [], MONTH)).toEqual(new Set());
  });

  it("non-uuid ids: filtered out, empty Set when none are left", async () => {
    expect(await loadReadySummarySourceIds(orgId, ["not-a-uuid", "also-bad"], MONTH)).toEqual(new Set());
  });

  it("invalid month key: empty Set", async () => {
    expect(await loadReadySummarySourceIds(orgId, [sourceAId], "2098-13")).toEqual(new Set());
    expect(await loadReadySummarySourceIds(orgId, [sourceAId], "not-a-month")).toEqual(new Set());
  });

  it("duplicate ids in the input are fine — the id still appears once in the result", async () => {
    const result = await loadReadySummarySourceIds(orgId, [sourceAId, sourceAId, sourceAId], MONTH);
    expect(result).toEqual(new Set([sourceAId]));
  });

  describe("no N+1: query count does not grow with the number of source ids", () => {
    // `vi.spyOn(db, "select")` cannot intercept anything here: `db` (`src/db/index.ts`) is a
    // `Proxy` whose `get` trap always calls `connection()` fresh and returns a freshly bound
    // method — it never reads back a property `defineProperty`'d onto the proxy's target, so
    // `vi.spyOn` throws "The property 'select' is not defined on the object" (confirmed by
    // running it). The Proxy is deliberate (see its own doc comment) and out of scope to change
    // for a test. Fallback: spy on the real `pg.Pool.query` this driver sits on — a normal
    // instance method, one call per SQL statement actually sent — which does intercept.
    function pool(): { query: (...args: unknown[]) => unknown } {
      const p = (globalThis as unknown as { __ngoExpensesPool?: { query: (...args: unknown[]) => unknown } })
        .__ngoExpensesPool;
      if (!p) throw new Error("pool not connected yet — call a db query first");
      return p;
    }

    beforeEach(async () => {
      // Force the lazy connection open before the first spy of each test, so `globalThis
      // .__ngoExpensesPool` is guaranteed to exist.
      await db.select({ id: organizations.id }).from(organizations).limit(1);
    });

    it("1 source id costs exactly 2 queries (access + summaries)", async () => {
      const spy = vi.spyOn(pool(), "query");
      try {
        await loadReadySummarySourceIds(orgId, [sourceAId], MONTH);
        expect(spy).toHaveBeenCalledTimes(2);
      } finally {
        spy.mockRestore();
      }
    });

    it("3 source ids still cost exactly 2 queries — batched, not one per source", async () => {
      const spy = vi.spyOn(pool(), "query");
      try {
        await loadReadySummarySourceIds(orgId, [sourceAId, sourceBId, sourceCId], MONTH);
        expect(spy).toHaveBeenCalledTimes(2);
      } finally {
        spy.mockRestore();
      }
    });

    it("invalid month: 0 queries, returns before touching the database", async () => {
      const spy = vi.spyOn(pool(), "query");
      try {
        await loadReadySummarySourceIds(orgId, [sourceAId, sourceBId, sourceCId], "not-a-month");
        expect(spy).toHaveBeenCalledTimes(0);
      } finally {
        spy.mockRestore();
      }
    });

    it("empty id list: 0 queries, returns before touching the database", async () => {
      const spy = vi.spyOn(pool(), "query");
      try {
        await loadReadySummarySourceIds(orgId, [], MONTH);
        expect(spy).toHaveBeenCalledTimes(0);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
