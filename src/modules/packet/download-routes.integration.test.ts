/**
 * `GET /api/downloads/packet` and `GET /api/downloads/summary`, pinned before PHASE-12 moved their
 * gate into `prepareMonthOutput` (PHASE-12 §9 Phase 1, P11).
 *
 * Characterisation: every refusal's status and exact text, and the served response's headers,
 * written as literals rather than by calling the helpers under test, so the refactor cannot pass
 * by changing both sides at once. Both routes run through the same table of cases.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

vi.mock("@/src/services/auth/session", () => ({ getSession: vi.fn() }));

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("packet and summary download routes (integration, pinned for PHASE-12)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, fundingSources, generatedArtifacts, lineItems, organizations } = await import(
    "@/src/db/schema"
  );
  const { createTestOrg } = await import("@/src/db/test-org");
  const { getSession } = await import("@/src/services/auth/session");
  const { clearAll: clearRateLimit } = await import("@/src/services/rate-limit");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { ingestExpenseDocument } = await import("@/src/services/storage/documents");
  const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");
  const { storage } = await import("@/src/services/storage/driver");

  const { GET: packetGet } = await import("@/app/api/downloads/packet/route");
  const { GET: summaryGet } = await import("@/app/api/downloads/summary/route");

  const getSessionMock = vi.mocked(getSession);

  const ROUTES = [
    { kind: "packet", get: packetGet, suffix: "Packet.pdf", type: "application/pdf" },
    {
      kind: "summary",
      get: summaryGet,
      suffix: "Summary.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  ] as const;

  let orgId: string;
  let sourceId: string;
  let itemId: string;
  let otherOrgSourceId: string;
  const createdOrgIds: string[] = [];

  let monthCounter = 0;
  /** A fresh, never-reused month, so artifacts and trash never leak between cases. */
  function freshMonth(): string {
    monthCounter += 1;
    const month = 1 + (monthCounter % 12);
    const year = 2087 + Math.floor(monthCounter / 12);
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  function label(month: string): string {
    const [year, mm] = month.split("-");
    return `${MONTH_NAMES[Number(mm) - 1]}_${year}`;
  }

  function signIn() {
    getSessionMock.mockResolvedValue({
      orgId,
      userId: "00000000-0000-7000-8000-000000000001",
      email: "e@example.com",
      role: "manager" as const,
      orgName: "Pin Org",
      docName: "Pin Org",
      activeMonth: "2087-01",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    } as Awaited<ReturnType<typeof getSession>>);
  }

  function request(
    kind: "packet" | "summary",
    params: Record<string, string>,
    headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin" },
  ): Request {
    const url = new URL(`http://localhost/api/downloads/${kind}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return new Request(url, { headers });
  }

  async function insertExpense(month: string, name: string, overrides: Record<string, unknown> = {}) {
    const [row] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId: sourceId,
        lineItemId: itemId,
        month,
        date: `${month}-05`,
        name,
        narrative: "A narrative.",
        paymentSource: "Cash",
        subtotalCents: 1_000,
        taxReimbursable: false,
        feesReimbursable: true,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, sourceId, month),
        ...overrides,
      })
      .returning({ id: expenses.id });
    return row.id;
  }

  async function documentExpense(expenseId: string) {
    const jpeg = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    for (const scope of ["proof", "receipt"] as const) {
      const result = await ingestExpenseDocument({
        orgId,
        expenseId,
        scope,
        file: new File([new Uint8Array(jpeg)], `${scope}.jpg`, { type: "image/jpeg" }),
      });
      if (!result.ok) throw new Error(result.error);
    }
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: `Pin Org ${Date.now()}`, docName: "Pin Org" });
    orgId = org.orgId;
    sourceId = org.fundingSourceId;
    createdOrgIds.push(orgId);
    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceId, name: "A item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    itemId = item.id;

    const other = await createTestOrg({ name: `Pin Other ${Date.now()}` });
    createdOrgIds.push(other.orgId);
    otherOrgSourceId = other.fundingSourceId;
  }, 30_000);

  afterAll(async () => {
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
      await rm(path.join(process.cwd(), ".storage", "org", id), { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    clearRateLimit();
    signIn();
  });

  describe.each(ROUTES)("$kind route", ({ kind, get, suffix, type }) => {
    it("401 when not signed in", async () => {
      getSessionMock.mockResolvedValue(null);
      const res = await get(request(kind, { month: freshMonth(), source: sourceId }));
      expect(res.status).toBe(401);
      expect(await res.text()).toBe("Not signed in");
    });

    it("403 on a cross-site request; a missing header falls through", async () => {
      const refused = await get(request(kind, { month: "2087-13", source: sourceId }, { "Sec-Fetch-Site": "cross-site" }));
      expect(refused.status).toBe(403);
      expect(await refused.text()).toBe("Cross-site downloads are not allowed");

      const noHeader = await get(request(kind, { month: "2087-13", source: sourceId }, {}));
      expect(noHeader.status).toBe(400);
    });

    it("400 on a malformed month", async () => {
      const res = await get(request(kind, { month: "2087-13", source: sourceId }));
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("Unknown month");
    });

    it("404 on a missing, malformed or foreign source — the same answer", async () => {
      for (const source of ["", "not-a-uuid", otherOrgSourceId]) {
        const res = await get(request(kind, { month: freshMonth(), source }));
        expect(res.status).toBe(404);
        expect(await res.text()).toBe("Unknown funding source");
      }
    });

    it("409 with the exact deletions text until confirmed", async () => {
      const month = freshMonth();
      const trashed = await insertExpense(month, "Trashed expense");
      await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, trashed));

      const refused = await get(request(kind, { month, source: sourceId }));
      expect(refused.status).toBe(409);
      expect(refused.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(await refused.text()).toBe(
        "1 expense was deleted from this reporting period and has not been confirmed:\n" +
          "• Trashed expense — A item — $10.00",
      );

      const confirmed = await get(request(kind, { month, source: sourceId, confirmedDeletions: "1" }));
      expect(confirmed.status).toBe(200);
    });

    it("409 with the exact documentation text while a record is incomplete", async () => {
      const month = freshMonth();
      await insertExpense(month, "Blocking expense");

      const res = await get(request(kind, { month, source: sourceId }));
      expect(res.status).toBe(409);
      expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(await res.text()).toBe(
        "1 record is missing documentation:\n• Blocking expense — A item — missing both",
      );
    });

    it("the deletions refusal comes before the documentation one", async () => {
      const month = freshMonth();
      await insertExpense(month, "Blocking expense");
      const trashed = await insertExpense(month, "Trashed expense");
      await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, trashed));

      const res = await get(request(kind, { month, source: sourceId }));
      expect(await res.text()).toMatch(/^1 expense was deleted/);
    });

    it("200 with the exact headers, pinned once, and served from the cache the second time", async () => {
      const month = freshMonth();
      await documentExpense(await insertExpense(month, "Complete expense"));

      const first = await get(request(kind, { month, source: sourceId }));
      expect(first.status).toBe(200);
      const body = Buffer.from(await first.arrayBuffer());
      const filename = `Pin_Org_${label(month)}_${suffix}`;
      expect(first.headers.get("Content-Type")).toBe(type);
      expect(first.headers.get("Content-Length")).toBe(String(body.byteLength));
      expect(first.headers.get("Content-Disposition")).toBe(
        `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
      );
      expect(first.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(first.headers.get("Cache-Control")).toBe("private, no-store");

      // Served from the cache: equal bytes alone would also hold after a rebuild, since outputs
      // are deterministic, so the second request must also write nothing.
      const put = vi.spyOn(storage(), "put");
      const second = await get(request(kind, { month, source: sourceId }));
      const writes = put.mock.calls.length;
      put.mockRestore();
      expect(writes).toBe(0);
      expect(Buffer.from(await second.arrayBuffer()).equals(body)).toBe(true);

      const rows = await db
        .select({ downloadedAt: generatedArtifacts.downloadedAt })
        .from(generatedArtifacts)
        .where(and(eq(generatedArtifacts.orgId, orgId), eq(generatedArtifacts.month, month)));
      expect(rows).toHaveLength(1);
      expect(rows[0].downloadedAt).not.toBeNull();
    }, 120_000);

    it("a month with no expenses is served", async () => {
      const res = await get(request(kind, { month: freshMonth(), source: sourceId }));
      expect(res.status).toBe(200);
    }, 120_000);

    it("429 with Retry-After once the org's generation budget is spent", async () => {
      const month = "2087-13"; // refused cheaply after the budget check
      for (let i = 0; i < 6; i += 1) await get(request(kind, { month, source: sourceId }));
      const res = await get(request(kind, { month, source: sourceId }));
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
      expect(await res.text()).toMatch(/^Too many documents requested at once\. Try again in \d+ seconds?\.$/);
    });
  });

  it("filenames gain the source name once the org has a second source", async () => {
    const [second] = await db
      .insert(fundingSources)
      .values({ orgId, name: "Second grant", type: "grant", sortOrder: 1, ...ORIGINAL_RULES })
      .returning({ id: fundingSources.id });
    try {
      for (const { kind, get, suffix } of ROUTES) {
        const month = freshMonth();
        const res = await get(request(kind, { month, source: sourceId }));
        expect(res.status).toBe(200);
        const filename = `Pin_Org_Source_1_${label(month)}_${suffix}`;
        expect(res.headers.get("Content-Disposition")).toBe(
          `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
        );
      }
    } finally {
      await db.delete(fundingSources).where(eq(fundingSources.id, second.id));
    }
  }, 120_000);
});
