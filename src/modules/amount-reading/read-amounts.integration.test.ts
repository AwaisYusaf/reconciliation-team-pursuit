/**
 * Reading amounts from receipts/proofs (Phase 10, D-105) against a real database and the local
 * storage driver: the access gate, the route's two input modes, org scoping, kind checks,
 * logging, rate limiting, and the Settings switch action.
 *
 * The OpenAI call itself is mocked (`src/services/openai/read-amounts.ts`'s `readAmounts`) —
 * never a real network call — while `costMicroUsd` stays real so the logged cost is genuine.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/services/auth/session", () => {
  class UnauthenticatedError extends Error {
    constructor() {
      super("Not signed in");
      this.name = "UnauthenticatedError";
    }
  }
  return { getSession: vi.fn(), requireSession: vi.fn(), UnauthenticatedError };
});
vi.mock("@/src/services/openai/read-amounts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/services/openai/read-amounts")>();
  return { ...actual, readAmounts: vi.fn() };
});

config({ path: ".env.local", quiet: true });

import { NextRequest } from "next/server";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("read amounts (integration, Phase 10)", async () => {
  const { db } = await import("@/src/db");
  const { aiUsageEvents, expenses, lineItems, organizations, supportingDocTypes } = await import(
    "@/src/db/schema"
  );
  const { createTestOrg } = await import("@/src/db/test-org");
  const { getSession, requireSession, UnauthenticatedError } = await import("@/src/services/auth/session");
  const { readAmounts } = await import("@/src/services/openai/read-amounts");
  const { readAmountsAllowedForOrg } = await import("./access");
  const { setReadAmountsEnabledAction } = await import("@/src/modules/settings/actions");
  const { ingestExpenseDocument } = await import("@/src/services/storage/documents");
  const { consume, clearAll } = await import("@/src/services/rate-limit");

  const { POST } = await import("@/app/api/files/read-amounts/route");

  const getSessionMock = vi.mocked(getSession);
  const requireSessionMock = vi.mocked(requireSession);
  const readAmountsMock = vi.mocked(readAmounts);

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let userId: string;

  let otherOrgId: string;

  const savedEnv = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_READ_MODEL };

  function sessionContext(orgId: string, userId: string, role: "admin" | "manager" = "admin") {
    return {
      orgId,
      userId,
      email: "e@example.com",
      role,
      orgName: "Org",
      docName: "Doc",
      activeMonth: "2094-01",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation_ai" as const,
    };
  }
  function asSession(orgId: string, userId: string, role: "admin" | "manager" = "admin") {
    const ctx = sessionContext(orgId, userId, role);
    getSessionMock.mockResolvedValue(ctx);
    requireSessionMock.mockResolvedValue(ctx);
  }
  function asExpired() {
    getSessionMock.mockResolvedValue(null);
    requireSessionMock.mockRejectedValue(new UnauthenticatedError());
  }

  async function setPlan(org: string, plan: "reconciliation" | "reconciliation_ai") {
    await db.update(organizations).set({ plan }).where(eq(organizations.id, org));
  }
  async function setSwitch(org: string, enabled: boolean) {
    await db.update(organizations).set({ readAmountsEnabled: enabled }).where(eq(organizations.id, org));
  }

  let refCounter = 0;
  async function makeExpense(org: string, source: string, item: string) {
    refCounter += 1;
    const [row] = await db
      .insert(expenses)
      .values({
        orgId: org,
        fundingSourceId: source,
        lineItemId: item,
        month: "2094-01",
        date: "2094-01-05",
        name: `Expense ${refCounter}`,
        paymentSource: "Cash",
        subtotalCents: 1_000,
        taxCents: 0,
        feesCents: 0,
        taxReimbursable: false,
        feesReimbursable: true,
        sortOrder: 0,
        referenceSeq: refCounter,
      })
      .returning({ id: expenses.id });
    return row.id;
  }

  async function jpegFile(name = "receipt.jpg"): Promise<File> {
    const buf = await sharp({
      create: { width: 60, height: 60, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .jpeg()
      .toBuffer();
    return new File([new Uint8Array(buf)], name, { type: "image/jpeg" });
  }

  async function pdfFile(name = "receipt.pdf"): Promise<File> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    page.drawText("receipt", { x: 20, y: 200 });
    const bytes = await doc.save();
    return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
  }

  function garbagePdfFile(name = "garbage.pdf"): File {
    // Declared as a PDF, but the bytes are not a PDF at all — inspectUpload's magic-byte/parse
    // check must refuse it (Phase 10 §4 "encrypted / corrupt PDF, disguised file").
    return new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], name, { type: "application/pdf" });
  }

  function readRequest(form: FormData): NextRequest {
    return new NextRequest("http://localhost/api/files/read-amounts", {
      method: "POST",
      body: form,
      headers: { "sec-fetch-site": "same-origin" },
    });
  }

  async function latestAmountRead(org: string) {
    const [row] = await db
      .select()
      .from(aiUsageEvents)
      .where(eq(aiUsageEvents.orgId, org))
      .orderBy(desc(aiUsageEvents.createdAt))
      .limit(1);
    return row ?? null;
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Amount Reads Org", activeMonth: "2094-01" });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;
    await setPlan(orgId, "reconciliation_ai");

    const { users } = await import("@/src/db/schema");
    const { hashPassword } = await import("@/src/services/auth/passwords");
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `amt-reads-${Date.now()}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    userId = user.id;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Travel", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    await db.insert(supportingDocTypes).values({ orgId, label: "W9", sortOrder: 0 });

    const other = await createTestOrg({ name: "Amount Reads Other Org" });
    otherOrgId = other.orgId;
    await setPlan(otherOrgId, "reconciliation_ai");
  }, 30_000);

  afterAll(async () => {
    process.env.OPENAI_API_KEY = savedEnv.key;
    process.env.OPENAI_READ_MODEL = savedEnv.model;
    if (orgId) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
      await rm(path.join(process.cwd(), ".storage", "org", orgId), { recursive: true, force: true });
    }
    if (otherOrgId) {
      await db.delete(organizations).where(eq(organizations.id, otherOrgId));
      await rm(path.join(process.cwd(), ".storage", "org", otherOrgId), { recursive: true, force: true });
    }
  });

  describe("access gate", () => {
    it("no OpenAI key configured → 403, and readAmountsAllowedForOrg is false (hidden)", async () => {
      delete process.env.OPENAI_API_KEY;
      process.env.OPENAI_READ_MODEL = "gpt-5.6-luna";
      try {
        expect(await readAmountsAllowedForOrg(orgId)).toBe(false);

        asSession(orgId, userId);
        const form = new FormData();
        form.set("file", await jpegFile());
        form.set("kind", "receipt");
        const response = await POST(readRequest(form));
        expect(response.status).toBe(403);
        expect((await response.json()).ok).toBe(false);
      } finally {
        process.env.OPENAI_API_KEY = "sk-test-integration-key";
      }
    });

    it("base plan org → 403", async () => {
      process.env.OPENAI_API_KEY = "sk-test-integration-key";
      process.env.OPENAI_READ_MODEL = "gpt-5.6-luna";
      await setPlan(orgId, "reconciliation");
      try {
        asSession(orgId, userId);
        const form = new FormData();
        form.set("file", await jpegFile());
        form.set("kind", "receipt");
        const response = await POST(readRequest(form));
        expect(response.status).toBe(403);
      } finally {
        await setPlan(orgId, "reconciliation_ai");
      }
    });

    it("Settings switch off → 403", async () => {
      await setSwitch(orgId, false);
      try {
        asSession(orgId, userId);
        const form = new FormData();
        form.set("file", await jpegFile());
        form.set("kind", "receipt");
        const response = await POST(readRequest(form));
        expect(response.status).toBe(403);
      } finally {
        await setSwitch(orgId, true);
      }
    });

    it("no session → 401", async () => {
      getSessionMock.mockResolvedValue(null);
      const form = new FormData();
      form.set("file", await jpegFile());
      form.set("kind", "receipt");
      const response = await POST(readRequest(form));
      expect(response.status).toBe(401);
    });

    it("bad origin → 403", async () => {
      asSession(orgId, userId);
      const form = new FormData();
      form.set("file", await jpegFile());
      form.set("kind", "receipt");
      const request = new NextRequest("http://localhost/api/files/read-amounts", {
        method: "POST",
        body: form,
        headers: { origin: "http://evil.example", host: "localhost" },
      });
      const response = await POST(request);
      expect(response.status).toBe(403);
    });
  });

  describe("uploaded file path", () => {
    it("AI plan + switch on + key configured: a clear file reads amounts and logs tokens + cost", async () => {
      asSession(orgId, userId);
      readAmountsMock.mockResolvedValue({
        outcome: "found",
        amounts: { subtotalCents: 11000, taxCents: 660, feesCents: 340, totalCents: 12000 },
        inputTokens: 1000,
        outputTokens: 100,
      });
      process.env.OPENAI_READ_PRICE_INPUT_PER_MTOK = "0.20";
      process.env.OPENAI_READ_PRICE_OUTPUT_PER_MTOK = "1.20";

      const form = new FormData();
      form.set("file", await jpegFile());
      form.set("kind", "receipt");
      const response = await POST(readRequest(form));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        ok: true,
        data: { found: true, subtotalCents: 11000, taxCents: 660, feesCents: 340, totalCents: 12000 },
      });

      const row = await latestAmountRead(orgId);
      expect(row).not.toBeNull();
      expect(row!.feature).toBe("amount_read");
      expect(row!.outcome).toBe("found");
      expect(row!.documentSource).toBe("upload");
      expect(row!.documentKind).toBe("receipt");
      expect(row!.inputTokens).toBe(1000);
      expect(row!.outputTokens).toBe(100);
      expect(row!.costMicroUsd).toBe(320); // 1000*0.20 + 100*1.20, real costMicroUsd

      delete process.env.OPENAI_READ_PRICE_INPUT_PER_MTOK;
      delete process.env.OPENAI_READ_PRICE_OUTPUT_PER_MTOK;
    });

    it("'none' outcome → 200 found:false, and a 'none' row with null cost", async () => {
      asSession(orgId, userId);
      readAmountsMock.mockResolvedValue({ outcome: "none", inputTokens: 50, outputTokens: 5 });

      const form = new FormData();
      form.set("file", await jpegFile());
      form.set("kind", "proof");
      const response = await POST(readRequest(form));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, data: { found: false } });

      const row = await latestAmountRead(orgId);
      expect(row!.outcome).toBe("none");
      expect(row!.documentKind).toBe("proof");
      expect(row!.costMicroUsd).toBeNull(); // no price env set in this test
    });

    it("'failed' outcome from OpenAI → 502 JSON, and a 'failed' row with null cost", async () => {
      asSession(orgId, userId);
      readAmountsMock.mockResolvedValue({ outcome: "failed", inputTokens: null, outputTokens: null });

      const form = new FormData();
      form.set("file", await jpegFile());
      form.set("kind", "receipt");
      const response = await POST(readRequest(form));
      expect(response.status).toBe(502);
      expect((await response.json()).ok).toBe(false);

      const row = await latestAmountRead(orgId);
      expect(row!.outcome).toBe("failed");
      expect(row!.costMicroUsd).toBeNull();
    });

    it("inspection refusal (garbage bytes declared as a PDF) → 400 and a failed row logged, OpenAI never called", async () => {
      asSession(orgId, userId);
      readAmountsMock.mockClear();

      const form = new FormData();
      form.set("file", garbagePdfFile());
      form.set("kind", "receipt");
      const response = await POST(readRequest(form));
      expect(response.status).toBe(400);
      expect((await response.json()).ok).toBe(false);
      expect(readAmountsMock).not.toHaveBeenCalled();

      const row = await latestAmountRead(orgId);
      expect(row!.outcome).toBe("failed");
      expect(row!.documentSource).toBe("upload");
    });

    it("bad kind ('supporting' or unknown) → 400, no row written", async () => {
      asSession(orgId, userId);
      const before = await latestAmountRead(orgId);

      const form = new FormData();
      form.set("file", await jpegFile());
      form.set("kind", "supporting");
      const response = await POST(readRequest(form));
      expect(response.status).toBe(400);

      const after = await latestAmountRead(orgId);
      expect(after?.id).toBe(before?.id); // unchanged — nothing logged for a rejected kind
    });

    it("neither file nor documentId → 400", async () => {
      asSession(orgId, userId);
      const response = await POST(readRequest(new FormData()));
      expect(response.status).toBe(400);
    });

    it("both file and documentId → 400", async () => {
      asSession(orgId, userId);
      const form = new FormData();
      form.set("file", await jpegFile());
      form.set("kind", "receipt");
      form.set("documentId", "00000000-0000-0000-0000-000000000000");
      const response = await POST(readRequest(form));
      expect(response.status).toBe(400);
    });
  });

  describe("documentId path (org-scoped, kind-checked)", () => {
    it("another organisation's documentId → 404, no row written for either org", async () => {
      const expenseId = await makeExpense(orgId, fundingSourceId, lineItemId);
      const ingested = await ingestExpenseDocument({
        orgId,
        expenseId,
        scope: "receipt",
        file: await jpegFile(),
      });
      if (!ingested.ok) throw new Error(ingested.error);

      const otherOrg = await createTestOrg({ name: "Cross Org Reader" });
      // finally: a failing assertion used to skip the cleanup and leave this org in the database.
      try {
        const { users } = await import("@/src/db/schema");
        const { hashPassword } = await import("@/src/services/auth/passwords");
        const [otherUser] = await db
          .insert(users)
          .values({
            orgId: otherOrg.orgId,
            email: `cross-${Date.now()}@example.test`,
            passwordHash: await hashPassword("original-password-here"),
            role: "admin",
          })
          .returning({ id: users.id });
        await setPlan(otherOrg.orgId, "reconciliation_ai");

        asSession(otherOrg.orgId, otherUser.id);
        const beforeOther = await latestAmountRead(otherOrg.orgId);

        const form = new FormData();
        form.set("documentId", ingested.documentId);
        const response = await POST(readRequest(form));
        expect(response.status).toBe(404);

        const afterOther = await latestAmountRead(otherOrg.orgId);
        expect(afterOther?.id).toBe(beforeOther?.id); // nothing logged for the attacker's org
      } finally {
        await db.delete(organizations).where(eq(organizations.id, otherOrg.orgId));
        await rm(path.join(process.cwd(), ".storage", "org", otherOrg.orgId), { recursive: true, force: true });
      }
    });

    it("supporting document id → 400 (kind check refuses)", async () => {
      const expenseId = await makeExpense(orgId, fundingSourceId, lineItemId);
      const ingested = await ingestExpenseDocument({
        orgId,
        expenseId,
        scope: "supporting",
        supportingType: "W9",
        file: await jpegFile(),
      });
      if (!ingested.ok) throw new Error(ingested.error);

      asSession(orgId, userId);
      const form = new FormData();
      form.set("documentId", ingested.documentId);
      const response = await POST(readRequest(form));
      expect(response.status).toBe(400);
    });

    it("trashed expense's document → 404", async () => {
      const expenseId = await makeExpense(orgId, fundingSourceId, lineItemId);
      const ingested = await ingestExpenseDocument({
        orgId,
        expenseId,
        scope: "proof",
        file: await jpegFile(),
      });
      if (!ingested.ok) throw new Error(ingested.error);

      await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, expenseId));

      asSession(orgId, userId);
      const form = new FormData();
      form.set("documentId", ingested.documentId);
      const response = await POST(readRequest(form));
      expect(response.status).toBe(404);
    });

    it("non-uuid documentId → 404", async () => {
      asSession(orgId, userId);
      const form = new FormData();
      form.set("documentId", "not-a-uuid");
      const response = await POST(readRequest(form));
      expect(response.status).toBe(404);
    });

    it("attached document reads successfully via storage, and the expense row is unchanged before/after", async () => {
      const expenseId = await makeExpense(orgId, fundingSourceId, lineItemId);
      const ingested = await ingestExpenseDocument({
        orgId,
        expenseId,
        scope: "receipt",
        file: await pdfFile(),
      });
      if (!ingested.ok) throw new Error(ingested.error);

      const before = await db
        .select({ subtotalCents: expenses.subtotalCents, taxCents: expenses.taxCents, feesCents: expenses.feesCents })
        .from(expenses)
        .where(eq(expenses.id, expenseId));

      asSession(orgId, userId);
      readAmountsMock.mockResolvedValue({
        outcome: "found",
        amounts: { subtotalCents: 5000, taxCents: 0, feesCents: 0, totalCents: 5000 },
        inputTokens: 10,
        outputTokens: 5,
      });

      const form = new FormData();
      form.set("documentId", ingested.documentId);
      const response = await POST(readRequest(form));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.found).toBe(true);
      expect(body.data.subtotalCents).toBe(5000);

      const after = await db
        .select({ subtotalCents: expenses.subtotalCents, taxCents: expenses.taxCents, feesCents: expenses.feesCents })
        .from(expenses)
        .where(eq(expenses.id, expenseId));
      expect(after).toEqual(before); // the route never writes `expenses`

      const row = await latestAmountRead(orgId);
      expect(row!.documentSource).toBe("attached");
      expect(row!.documentKind).toBe("receipt");
    });
  });

  describe("ai_usage_events constraints (D-106)", () => {
    it("refuses an amount_read row without its document source or kind, or with a summary outcome", async () => {
      const base = { orgId, feature: "amount_read" as const, model: "test-model" };
      // Each insert must fail on the check constraint, not on anything else.
      const refused = async (values: Record<string, unknown>) => {
        const error = await db
          .insert(aiUsageEvents)
          .values({ ...base, ...values } as typeof aiUsageEvents.$inferInsert)
          .then(() => null, (e: unknown) => e);
        expect(String((error as { cause?: unknown })?.cause ?? error)).toContain("ai_usage_events_amount_read_ck");
      };
      await refused({ outcome: "found", documentKind: "receipt" });
      await refused({ outcome: "found", documentSource: "upload" });
      await refused({ outcome: "success", documentSource: "upload", documentKind: "receipt" });

      // And the well-formed row is accepted.
      await db
        .insert(aiUsageEvents)
        .values({ ...base, outcome: "none", documentSource: "attached", documentKind: "proof" });
    });
  });

  describe("rate limiting", () => {
    it("429 once the org's hourly budget (200) is exhausted, and clearAll resets it", async () => {
      clearAll();
      try {
        for (let i = 0; i < 200; i += 1) consume("readAmounts", orgId);

        asSession(orgId, userId);
        readAmountsMock.mockResolvedValue({ outcome: "none", inputTokens: null, outputTokens: null });
        const form = new FormData();
        form.set("file", await jpegFile());
        form.set("kind", "receipt");
        const response = await POST(readRequest(form));
        expect(response.status).toBe(429);
      } finally {
        clearAll();
      }
    });
  });

  describe("setReadAmountsEnabledAction (Settings switch, admin-only)", () => {
    it("an admin can turn it off and back on; the value persists", async () => {
      asSession(orgId, userId, "admin");

      const off = await setReadAmountsEnabledAction(false);
      expect(off.ok).toBe(true);
      const [afterOff] = await db
        .select({ v: organizations.readAmountsEnabled })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      expect(afterOff.v).toBe(false);

      const on = await setReadAmountsEnabledAction(true);
      expect(on.ok).toBe(true);
      const [afterOn] = await db
        .select({ v: organizations.readAmountsEnabled })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      expect(afterOn.v).toBe(true);
    });

    it("a manager is refused with FORBIDDEN, and the value is unchanged", async () => {
      asSession(orgId, userId, "manager");
      const [before] = await db
        .select({ v: organizations.readAmountsEnabled })
        .from(organizations)
        .where(eq(organizations.id, orgId));

      const { FORBIDDEN } = await import("@/src/lib/action-session");
      const result = await setReadAmountsEnabledAction(!before.v);
      expect(result).toEqual({ ok: false, error: FORBIDDEN });

      const [after] = await db
        .select({ v: organizations.readAmountsEnabled })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      expect(after.v).toBe(before.v);
    });

    it("an expired session is refused (SESSION_EXPIRED)", async () => {
      asExpired();
      const { SESSION_EXPIRED } = await import("@/src/lib/action-result");
      const result = await setReadAmountsEnabledAction(true);
      expect(result).toEqual({ ok: false, error: SESSION_EXPIRED });
    });
  });
});
