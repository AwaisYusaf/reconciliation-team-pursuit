/**
 * The invoice read ROUTE (Phase 14 §4), against a real database.
 *
 * `read-invoice.test.ts` covers the parser: what the model's JSON becomes. Nothing covered the
 * route around it, so PHASE-14 §4's claim that "exactly one `ai_usage_events` row is written
 * per request that reaches a resolved document, whatever the outcome" was prose only — and so
 * were the three messages the ticket words for the reader (too many pages, nothing readable,
 * too many lines).
 *
 * The OpenAI call itself is mocked; the cost calculation stays real, so the logged figure is
 * the one the org would actually be billed for.
 *
 * Skipped when DATABASE_URL is absent.
 */
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
vi.mock("@/src/services/openai/read-invoice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/services/openai/read-invoice")>();
  return { ...actual, readInvoice: vi.fn() };
});

config({ path: ".env.local", quiet: true });

import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("read invoice route (integration, Phase 14 §4)", async () => {
  const { db } = await import("@/src/db");
  const { aiUsageEvents, organizations, users } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { getSession } = await import("@/src/services/auth/session");
  const { readInvoice } = await import("@/src/services/openai/read-invoice");
  const { MAX_PAGES_READ } = await import("@/src/modules/amount-reading/page-cap");
  const { UI } = await import("@/src/domain/strings");
  const { clearAll } = await import("@/src/services/rate-limit");

  const { POST } = await import("@/app/api/files/read-invoice/route");

  const getSessionMock = vi.mocked(getSession);
  const readInvoiceMock = vi.mocked(readInvoice);

  let orgId: string;
  let userId: string;

  const savedEnv = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_READ_MODEL };

  function sessionContext() {
    return {
      orgId,
      userId,
      email: "e@example.com",
      role: "admin" as const,
      orgName: "Org",
      docName: "Doc",
      activeMonth: "2093-03",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation_ai" as const,
    };
  }

  async function pdfOfPages(pages: number, name = "invoice.pdf"): Promise<File> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i += 1) doc.addPage([300, 300]).drawText(`page ${i}`, { x: 20, y: 200 });
    const bytes = await doc.save();
    return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
  }

  function postRequest(file: File): NextRequest {
    const form = new FormData();
    form.set("file", file);
    return new NextRequest("http://localhost/api/files/read-invoice", {
      method: "POST",
      body: form,
      headers: { "sec-fetch-site": "same-origin" },
    });
  }

  /** Every usage row this org has logged for the invoice feature. */
  async function invoiceUsage() {
    return db
      .select()
      .from(aiUsageEvents)
      .where(and(eq(aiUsageEvents.orgId, orgId), eq(aiUsageEvents.feature, "invoice_read")));
  }

  const line = { name: "Widget", description: "One widget", subtotalCents: 1000, taxCents: 0, feesCents: 0 };
  const foundResult = {
    outcome: "found" as const,
    invoice: {
      vendor: "Detroit Sound Supply",
      invoiceDate: "2093-03-18",
      billTaxCents: null,
      billFeesCents: null,
      lines: [line],
    },
    truncated: false,
    unreadableLines: 0,
    inputTokens: 100,
    outputTokens: 20,
  };

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_READ_MODEL = "test-model";

    const org = await createTestOrg({ name: "Invoice Route Org", activeMonth: "2093-03" });
    orgId = org.orgId;
    await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, orgId));

    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `invoice-route-${Date.now()}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    userId = user.id;
  }, 60_000);

  afterAll(async () => {
    process.env.OPENAI_API_KEY = savedEnv.key;
    process.env.OPENAI_READ_MODEL = savedEnv.model;
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  beforeEach(async () => {
    clearAll();
    getSessionMock.mockResolvedValue(sessionContext());
    readInvoiceMock.mockReset();
    await db.delete(aiUsageEvents).where(eq(aiUsageEvents.orgId, orgId));
  });

  it("reads an invoice, answers the charges, and logs exactly one usage row", async () => {
    readInvoiceMock.mockResolvedValue(foundResult);

    const response = await POST(postRequest(await pdfOfPages(1)));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.found).toBe(true);
    expect(body.data.invoice.vendor).toBe("Detroit Sound Supply");
    expect(body.data.invoice.lines).toHaveLength(1);
    expect(body.data.unreadableLines).toBe(0);

    const usage = await invoiceUsage();
    expect(usage).toHaveLength(1);
    expect(usage[0].outcome).toBe("found");
    // The document columns the `ai_usage_events_invoice_read_ck` constraint requires.
    expect(usage[0].documentSource).toBe("upload");
    expect(usage[0].documentKind).toBe("receipt");
    expect(usage[0].costMicroUsd).not.toBeNull();
  });

  it("says nothing was readable, in the ticket's words, and still logs the run", async () => {
    readInvoiceMock.mockResolvedValue({ outcome: "none", inputTokens: 80, outputTokens: 5 });

    const response = await POST(postRequest(await pdfOfPages(1)));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.found).toBe(false);
    expect(body.data.error).toBe(UI.readInvoiceNothingFound);

    // A read that cost money is logged even though it produced nothing.
    const usage = await invoiceUsage();
    expect(usage).toHaveLength(1);
    expect(usage[0].outcome).toBe("none");
  });

  it("reports a failed read as a failure, and logs that too", async () => {
    readInvoiceMock.mockResolvedValue({ outcome: "failed", inputTokens: null, outputTokens: null });

    const response = await POST(postRequest(await pdfOfPages(1)));
    expect(response.status).toBe(502);
    expect((await response.json()).ok).toBe(false);

    const usage = await invoiceUsage();
    expect(usage).toHaveLength(1);
    expect(usage[0].outcome).toBe("failed");
  });

  it("passes the truncated message through when the bill had more lines than the cap", async () => {
    readInvoiceMock.mockResolvedValue({ ...foundResult, truncated: true });

    const body = await (await POST(postRequest(await pdfOfPages(1)))).json();
    expect(body.data.truncated).toBe(true);
    expect(body.data.truncatedMessage).toBe(UI.readInvoiceTooManyLines);
  });

  it("says how many charges could not be read, rather than dropping them in silence", async () => {
    readInvoiceMock.mockResolvedValue({ ...foundResult, unreadableLines: 3 });

    const body = await (await POST(postRequest(await pdfOfPages(1)))).json();
    expect(body.data.unreadableLines).toBe(3);
  });

  describe("the page cap, at the boundary", () => {
    it(`reads a document of exactly ${MAX_PAGES_READ} pages`, async () => {
      readInvoiceMock.mockResolvedValue(foundResult);

      const response = await POST(postRequest(await pdfOfPages(MAX_PAGES_READ)));
      expect(response.status).toBe(200);
      expect(readInvoiceMock).toHaveBeenCalledOnce();
    }, 30_000);

    it("refuses one page over it, with the real page count in the message, and never calls the model", async () => {
      const over = MAX_PAGES_READ + 1;
      const response = await POST(postRequest(await pdfOfPages(over)));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe(UI.readInvoiceTooManyPages(over, MAX_PAGES_READ));
      // The point of the cap: OpenAI bills per page, so the refusal has to come first.
      expect(readInvoiceMock).not.toHaveBeenCalled();

      // Still logged, because the request reached a resolved document (PHASE-14 §4).
      const usage = await invoiceUsage();
      expect(usage).toHaveLength(1);
      expect(usage[0].outcome).toBe("failed");
    }, 30_000);
  });

  it("accepts a photo of an invoice, not only a PDF (C8)", async () => {
    readInvoiceMock.mockResolvedValue(foundResult);

    const png = await sharp({
      create: { width: 60, height: 60, channels: 3, background: { r: 3, g: 3, b: 3 } },
    })
      .png()
      .toBuffer();

    const response = await POST(
      postRequest(new File([new Uint8Array(png)], "invoice.png", { type: "image/png" })),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.found).toBe(true);
  });

  it("refuses a file that is neither a PDF nor a photo, before any model call", async () => {
    const response = await POST(
      postRequest(new File([new Uint8Array([1, 2, 3, 4])], "notes.txt", { type: "text/plain" })),
    );
    expect(response.status).toBe(400);
    expect(readInvoiceMock).not.toHaveBeenCalled();

    // `inspectUpload` sniffs the bytes and refuses first, with its own wording, so the route's
    // own `UI.invoiceFileType` line is a backstop rather than the message anyone normally
    // sees. Asserted as "a readable refusal", not as one exact string, because pinning the
    // wrong layer's sentence here would break on an unrelated change to the sniffer.
    const { error } = await response.json();
    expect(typeof error).toBe("string");
    expect(error.length).toBeGreaterThan(10);
  });

  it("refuses an organisation whose plan does not include reading, before any model call", async () => {
    await db.update(organizations).set({ plan: "reconciliation" }).where(eq(organizations.id, orgId));
    try {
      const response = await POST(postRequest(await pdfOfPages(1)));
      expect(response.status).toBe(403);
      expect(readInvoiceMock).not.toHaveBeenCalled();
      // Refused before the document was resolved, so nothing is billed and nothing is logged.
      expect(await invoiceUsage()).toHaveLength(0);
    } finally {
      await db
        .update(organizations)
        .set({ plan: "reconciliation_ai" })
        .where(eq(organizations.id, orgId));
    }
  });

  it("refuses a request that did not come from this app", async () => {
    const form = new FormData();
    form.set("file", await pdfOfPages(1));
    const cross = new NextRequest("http://localhost/api/files/read-invoice", {
      method: "POST",
      body: form,
      headers: { "sec-fetch-site": "cross-site" },
    });

    const response = await POST(cross);
    expect(response.status).toBe(403);
    expect(readInvoiceMock).not.toHaveBeenCalled();
  });

  it("refuses when there is no session at all", async () => {
    getSessionMock.mockResolvedValue(null);
    const response = await POST(postRequest(await pdfOfPages(1)));
    expect(response.status).toBe(401);
    expect(readInvoiceMock).not.toHaveBeenCalled();
  });
});
