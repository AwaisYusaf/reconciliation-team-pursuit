/**
 * Creating drafts from one uploaded invoice (Phase 14 §3, D-115): the guard order in
 * `app/api/expenses/from-invoice/route.ts`, against a real database and the local storage
 * driver. Modelled on `src/modules/amount-reading/read-amounts.integration.test.ts` (route
 * imported directly, a constructed `Request` posted to it) and `invisibility.integration.test.ts`
 * / `documents.integration.test.ts` for the "nothing was written" and "no object left behind"
 * assertion patterns.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

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

config({ path: ".env.local", quiet: true });

import { NextRequest } from "next/server";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("create drafts from an invoice (integration, Phase 14 §3)", async () => {
  const { db } = await import("@/src/db");
  const {
    expenseDrafts,
    expenseImports,
    fundingSources,
    expenseAuditEvents,
    expenseDocuments,
    expenses,
    lineItems,
    monthLockEvents,
    monthStatuses,
    organizations,
    paymentSources,
    recurringItems,
    users,
    vendorDefaults,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");
  const { getSession, requireSession } = await import("@/src/services/auth/session");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { storage } = await import("@/src/services/storage/driver");
  const { MAX_ORG_BYTES } = await import("@/src/services/storage/documents");
  const { MAX_PAGES_READ } = await import("@/src/modules/amount-reading/page-cap");
  const { loadInvoiceMatchContext } = await import("@/src/modules/expense-imports/match-context");
  const { checkDuplicateInvoiceAction } = await import("@/src/modules/expense-imports/import-actions");
  const { UI } = await import("@/src/domain/strings");
  const { monthLabel } = await import("@/src/domain/dates");

  const { POST } = await import("@/app/api/expenses/from-invoice/route");

  const getSessionMock = vi.mocked(getSession);
  const requireSessionMock = vi.mocked(requireSession);

  let orgId: string;
  let fundingSourceId: string;
  let otherFundingSourceId: string;
  let lineItemId: string;
  let userId: string;

  let otherOrgId: string;
  let otherOrgLineItemId: string;

  const savedEnv = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_READ_MODEL };

  function sessionContext(org: string, user: string, activeMonth: string) {
    return {
      orgId: org,
      userId: user,
      email: "e@example.com",
      role: "admin" as const,
      orgName: "Org",
      docName: "Doc",
      activeMonth,
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation_ai" as const,
    };
  }
  /** Sets both `getSession` (the route's own check) and `requireSession` (what `actionSession`,
   *  used by `checkDuplicateInvoiceAction`, goes through). */
  function asSession(org: string, user: string, month = "2095-01") {
    const ctx = sessionContext(org, user, month);
    getSessionMock.mockResolvedValue(ctx);
    requireSessionMock.mockResolvedValue(ctx);
  }

  async function pdfFile(name = "invoice.pdf", pages = 1): Promise<File> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i += 1) {
      const page = doc.addPage([300, 300]);
      page.drawText(`invoice page ${i + 1}`, { x: 20, y: 200 });
    }
    const bytes = await doc.save();
    return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
  }

  async function pdfBytes(pages = 1): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i += 1) doc.addPage([300, 300]);
    return doc.save();
  }

  function garbagePdfFile(name = "garbage.pdf"): File {
    return new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], name, { type: "application/pdf" });
  }

  async function pngDeclaredAsPdf(name = "sneaky.pdf"): Promise<File> {
    const buf = await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .png()
      .toBuffer();
    return new File([new Uint8Array(buf)], name, { type: "application/pdf" });
  }

  type RowOverrides = Partial<{
    name: string;
    lineItemId: string;
    paymentSource: string;
    description: string;
    narrative: string;
    subtotal: string;
    tax: string;
    fees: string;
    date: string;
    note: string;
    kind: "expense" | "draft";
  }>;

  function row(overrides: RowOverrides = {}) {
    return {
      name: "Widget",
      lineItemId,
      paymentSource: "Operating account",
      description: "One widget",
      narrative: "",
      note: "",
      // These tests are about the import path itself, so every row defaults to a draft: the
      // relaxed rules, which is what "create drafts from an invoice" originally meant. The
      // expense path has its own cases.
      kind: "draft" as const,
      subtotal: "100.00",
      tax: "0.00",
      fees: "0.00",
      date: "2095-01-05",
      ...overrides,
    };
  }

  function buildForm(input: {
    file: File;
    fundingSourceId: string;
    rows: unknown[];
    vendorName?: string;
    invoiceDate?: string;
  }): FormData {
    const form = new FormData();
    form.set("file", input.file);
    form.set("fundingSourceId", input.fundingSourceId);
    form.set("rows", JSON.stringify(input.rows));
    if (input.vendorName !== undefined) form.set("vendorName", input.vendorName);
    if (input.invoiceDate !== undefined) form.set("invoiceDate", input.invoiceDate);
    return form;
  }

  /** Post rows exactly as given, including shapes the screen could never produce. */
  function postFormWithRawRows(file: File, fsId: string, rows: unknown[]): FormData {
    const form = new FormData();
    form.set("file", file);
    form.set("fundingSourceId", fsId);
    form.set("rows", JSON.stringify(rows));
    return form;
  }

  function postRequest(form: FormData): NextRequest {
    return new NextRequest("http://localhost/api/expenses/from-invoice", {
      method: "POST",
      body: form,
      headers: { "sec-fetch-site": "same-origin" },
    });
  }

  async function countRows(org: string) {
    const imports = await db.select().from(expenseImports).where(eq(expenseImports.orgId, org));
    const drafts = await db.select().from(expenseDrafts).where(eq(expenseDrafts.orgId, org));
    return { imports, drafts };
  }

  async function lockMonth(fsId: string, month: string) {
    await db
      .insert(monthStatuses)
      .values({ orgId, fundingSourceId: fsId, month, lockedAt: new Date() })
      .onConflictDoUpdate({
        target: [monthStatuses.orgId, monthStatuses.fundingSourceId, monthStatuses.month],
        set: { lockedAt: new Date() },
      });
  }

  async function unlockMonth(fsId: string, month: string) {
    await db
      .update(monthStatuses)
      .set({ lockedAt: null })
      .where(
        and(
          eq(monthStatuses.orgId, orgId),
          eq(monthStatuses.fundingSourceId, fsId),
          eq(monthStatuses.month, month),
        ),
      );
  }

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "sk-test-integration-key";
    process.env.OPENAI_READ_MODEL = "gpt-5.6-luna";

    const org = await createTestOrg({ name: "Invoice Drafts Org", activeMonth: "2095-01" });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;
    await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, orgId));

    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `invoice-drafts-${Date.now()}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    userId = user.id;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Supplies", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    const [otherSource] = await db
      .insert(fundingSources)
      .values({
        orgId,
        name: "Source 2",
        type: "grant",
        sortOrder: 1,
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: fundingSources.id });
    otherFundingSourceId = otherSource.id;

    await db.insert(paymentSources).values({ orgId, label: "Operating account", sortOrder: 0 });

    const other = await createTestOrg({ name: "Invoice Drafts Other Org" });
    otherOrgId = other.orgId;
    const [otherItem] = await db
      .insert(lineItems)
      .values({
        orgId: otherOrgId,
        fundingSourceId: other.fundingSourceId,
        name: "Other org item",
        scheduledValueCents: 100_000,
        sortOrder: 0,
      })
      .returning({ id: lineItems.id });
    otherOrgLineItemId = otherItem.id;
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

  it("locked month: refused with UI.monthLocked, and nothing is written or stored", async () => {
    asSession(orgId, userId, "2095-02");
    await lockMonth(fundingSourceId, "2095-02");
    try {
      const before = await countRows(orgId);
      const response = await POST(
        postRequest(buildForm({ file: await pdfFile(), fundingSourceId, rows: [row()] })),
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe(UI.monthLocked(monthLabel("2095-02")));

      const after = await countRows(orgId);
      expect(after.imports).toHaveLength(before.imports.length);
      expect(after.drafts).toHaveLength(before.drafts.length);
    } finally {
      await unlockMonth(fundingSourceId, "2095-02");
    }
  });

  /**
   * The cleanup branch (`deleteStoredObjects` on a refusal from inside the transaction) is only
   * reachable in a real race: a lock landing between the route's fast check and the
   * authoritative one inside the transaction. `monthLocked` is mocked to answer null once and
   * locked after that, which is exactly that race, so the branch is proven rather than assumed.
   */
  it("a lock landing between the fast check and the transaction takes the stored object back out", async () => {
    const before = await countRows(orgId);
    const importsDir = path.join(
      process.cwd(),
      ".storage",
      "org",
      orgId,
      "months",
      "2095-01",
      "expense-imports",
    );
    const filesBefore = await readdir(importsDir).catch(() => [] as string[]);

    vi.resetModules();
    vi.doMock("@/src/modules/packet/month-guard", () => ({
      monthLocked: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ fundingSourceId, month: "2095-01" }),
    }));
    try {
      // The isolated registry re-runs the session mock's factory, so the fresh copies have to be
      // pointed at the same session again.
      const isolatedSession = await import("@/src/services/auth/session");
      vi.mocked(isolatedSession.getSession).mockResolvedValue(sessionContext(orgId, userId, "2095-01"));
      const { POST: isolatedPost } = await import("@/app/api/expenses/from-invoice/route");

      const response = await isolatedPost(
        postRequest(buildForm({ file: await pdfFile(), fundingSourceId, rows: [row()] })),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe(UI.monthLocked(monthLabel("2095-01")));
    } finally {
      vi.doUnmock("@/src/modules/packet/month-guard");
      vi.resetModules();
    }

    const after = await countRows(orgId);
    expect(after.imports).toHaveLength(before.imports.length);
    expect(after.drafts).toHaveLength(before.drafts.length);
    // No orphan: the object written before the transaction was taken back out again.
    expect(await readdir(importsDir).catch(() => [] as string[])).toEqual(filesBefore);
  });

  it("archived funding source: refused, nothing written", async () => {
    asSession(orgId, userId);
    await db
      .update(fundingSources)
      .set({ archivedAt: new Date() })
      .where(eq(fundingSources.id, otherFundingSourceId));
    try {
      const before = await countRows(orgId);
      // Blank line item (a draft allows it) and a payment source that exists org-wide, so the
      // only thing that can refuse this row is the archived check itself — not an unrelated
      // ownership failure that would pass even with the archived guard deleted.
      const response = await POST(
        postRequest(
          buildForm({
            file: await pdfFile(),
            fundingSourceId: otherFundingSourceId,
            rows: [row({ lineItemId: "" })],
          }),
        ),
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe(
        "That funding source is archived. Unarchive it in Settings to add expenses to it.",
      );
      expect(await countRows(orgId)).toEqual(before);
    } finally {
      await db
        .update(fundingSources)
        .set({ archivedAt: null })
        .where(eq(fundingSources.id, otherFundingSourceId));
    }
  });

  it("zero posted rows: refused with UI.invoiceNoCharges, nothing written", async () => {
    asSession(orgId, userId);
    const before = await countRows(orgId);
    const response = await POST(postRequest(buildForm({ file: await pdfFile(), fundingSourceId, rows: [] })));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(UI.invoiceNoCharges);
    expect(await countRows(orgId)).toEqual(before);
  });

  it("storage quota full: refused, nothing written", async () => {
    asSession(orgId, userId);

    // Fill the org's quota with a synthetic ballast row, charged the same way `orgStorageBytes`
    // counts `month_lock_events` (documents.ts's SQL) — cheapest table to fake a full org with.
    await db.insert(monthLockEvents).values({
      orgId,
      fundingSourceId,
      month: "2095-01",
      s3Key: `org/${orgId}/ballast.pdf`,
      sizeBytes: MAX_ORG_BYTES,
    });
    try {
      const before = await countRows(orgId);
      const response = await POST(
        postRequest(buildForm({ file: await pdfFile(), fundingSourceId, rows: [row()] })),
      );
      expect(response.status).toBe(400);
      expect(await countRows(orgId)).toEqual(before);
    } finally {
      await db.delete(monthLockEvents).where(eq(monthLockEvents.orgId, orgId));
    }
  });

  it("a non-PDF upload declared as a PDF is refused, nothing written", async () => {
    asSession(orgId, userId);
    const before = await countRows(orgId);
    const response = await POST(
      postRequest(buildForm({ file: await pngDeclaredAsPdf(), fundingSourceId, rows: [row()] })),
    );
    expect(response.status).toBe(400);
    expect(await countRows(orgId)).toEqual(before);
  });

  it("a malformed/garbage upload declared as a PDF is refused, nothing written", async () => {
    asSession(orgId, userId);
    const before = await countRows(orgId);
    const response = await POST(
      postRequest(buildForm({ file: garbagePdfFile(), fundingSourceId, rows: [row()] })),
    );
    expect(response.status).toBe(400);
    expect(await countRows(orgId)).toEqual(before);
  });

  it("a PDF over the page cap is refused with UI.readInvoiceTooManyPages, nothing written", async () => {
    asSession(orgId, userId);
    const before = await countRows(orgId);
    const response = await POST(
      postRequest(
        buildForm({ file: await pdfFile("big.pdf", MAX_PAGES_READ + 1), fundingSourceId, rows: [row()] }),
      ),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(UI.readInvoiceTooManyPages(MAX_PAGES_READ + 1, MAX_PAGES_READ));
    expect(await countRows(orgId)).toEqual(before);
  });

  it("a PDF exactly at the page cap is allowed through", async () => {
    asSession(orgId, userId, "2095-06");
    const response = await POST(
      postRequest(
        buildForm({
          file: await pdfFile("exact-cap.pdf", MAX_PAGES_READ),
          fundingSourceId,
          rows: [row({ name: "At the cap" })],
        }),
      ),
    );
    expect(response.status).toBe(200);
  });

  it("cross-org line item id in a posted row is refused (D-93 invariant)", async () => {
    asSession(orgId, userId);
    const before = await countRows(orgId);
    const response = await POST(
      postRequest(
        buildForm({
          file: await pdfFile(),
          fundingSourceId,
          rows: [row({ lineItemId: otherOrgLineItemId })],
        }),
      ),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Choose a line item.");
    expect(await countRows(orgId)).toEqual(before);
  });

  it("cross-source line item id (same org, wrong funding source) is refused", async () => {
    asSession(orgId, userId);
    const [crossItem] = await db
      .insert(lineItems)
      .values({
        orgId,
        fundingSourceId: otherFundingSourceId,
        name: "Wrong source item",
        scheduledValueCents: 1000,
        sortOrder: 0,
      })
      .returning({ id: lineItems.id });

    const before = await countRows(orgId);
    const response = await POST(
      postRequest(
        buildForm({ file: await pdfFile(), fundingSourceId, rows: [row({ lineItemId: crossItem.id })] }),
      ),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Choose a line item.");
    expect(await countRows(orgId)).toEqual(before);
  });

  it("an unknown/retired payment source label is refused", async () => {
    asSession(orgId, userId);
    const before = await countRows(orgId);
    const response = await POST(
      postRequest(
        buildForm({
          file: await pdfFile(),
          fundingSourceId,
          rows: [row({ paymentSource: "Not a real payment source" })],
        }),
      ),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Choose a payment source.");
    expect(await countRows(orgId)).toEqual(before);
  });

  it("a row missing its line item and narrative is allowed (that is the point of a draft)", async () => {
    asSession(orgId, userId);
    const response = await POST(
      postRequest(
        buildForm({
          file: await pdfFile(),
          fundingSourceId,
          rows: [row({ name: "Needs review", lineItemId: "", narrative: "" })],
        }),
      ),
    );
    expect(response.status).toBe(200);
    const [draft] = await db
      .select()
      .from(expenseDrafts)
      .where(and(eq(expenseDrafts.orgId, orgId), eq(expenseDrafts.name, "Needs review")))
      .orderBy(expenseDrafts.createdAt);
    expect(draft.lineItemId).toBeNull();
    expect(draft.narrative).toBeNull();
  });

  it("a row with an empty name is refused, nothing written", async () => {
    asSession(orgId, userId);
    const before = await countRows(orgId);
    const response = await POST(
      postRequest(buildForm({ file: await pdfFile(), fundingSourceId, rows: [row({ name: "  " })] })),
    );
    expect(response.status).toBe(400);
    expect(await countRows(orgId)).toEqual(before);
  });

  it("a row with a malformed money string is refused, nothing written", async () => {
    asSession(orgId, userId);
    const before = await countRows(orgId);
    const response = await POST(
      postRequest(
        buildForm({ file: await pdfFile(), fundingSourceId, rows: [row({ subtotal: "not a number" })] }),
      ),
    );
    expect(response.status).toBe(400);
    expect(await countRows(orgId)).toEqual(before);
  });

  describe("optionalCents: billTaxCents/billFeesCents arrive from the client already in cents", () => {
    it("posting billTaxCents \"1250\" stores 1250, not 125000 (regression: was parsed as dollars)", async () => {
      asSession(orgId, userId, "2095-08");
      const form = buildForm({
        file: await pdfFile(),
        fundingSourceId,
        rows: [row({ name: "Cents not dollars" })],
      });
      form.set("billTaxCents", "1250");
      form.set("billFeesCents", "0");

      const response = await POST(postRequest(form));
      expect(response.status).toBe(200);

      const [imported] = await db
        .select()
        .from(expenseImports)
        .where(and(eq(expenseImports.orgId, orgId), eq(expenseImports.month, "2095-08")))
        .orderBy(expenseImports.createdAt);
      expect(imported.billTaxCents).toBe(1250);
      expect(imported.billFeesCents).toBe(0);
    });

    it("a non-integer billTaxCents is stored as null (never read), not coerced to zero or garbage", async () => {
      asSession(orgId, userId, "2095-09");
      const form = buildForm({
        file: await pdfFile(),
        fundingSourceId,
        rows: [row({ name: "Garbage bill tax" })],
      });
      form.set("billTaxCents", "not a number");

      const response = await POST(postRequest(form));
      expect(response.status).toBe(200);

      const [imported] = await db
        .select()
        .from(expenseImports)
        .where(and(eq(expenseImports.orgId, orgId), eq(expenseImports.month, "2095-09")))
        .orderBy(expenseImports.createdAt);
      expect(imported.billTaxCents).toBeNull();
    });
  });

  describe("regression: the route learns the vendor for rows saved as real expenses", () => {
    it("a kind: expense row teaches vendor_defaults for that org/name (it did not before)", async () => {
      asSession(orgId, userId, "2095-10");
      const response = await POST(
        postRequest(
          buildForm({
            file: await pdfFile(),
            fundingSourceId,
            rows: [
              row({
                name: "Detroit Sound Supply",
                kind: "expense",
                narrative: "Learned from an invoice.",
              }),
            ],
          }),
        ),
      );
      expect(response.status).toBe(200);

      const [vendor] = await db
        .select()
        .from(vendorDefaults)
        .where(and(eq(vendorDefaults.orgId, orgId), eq(vendorDefaults.name, "Detroit Sound Supply")));
      expect(vendor).toBeDefined();
      expect(vendor.defaultLineItemId).toBe(lineItemId);
    });
  });

  describe("happy path", () => {
    it("lands drafts with the session's active month, right fields, sortOrder in posted order, and the server-recomputed sha256", async () => {
      asSession(orgId, userId, "2095-03");
      const bytes = await pdfBytes(2);
      const realSha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
      const file = new File([new Uint8Array(bytes)], "invoice.pdf", { type: "application/pdf" });

      const rows = [
        row({ name: "First charge", subtotal: "50.00", tax: "1.00", fees: "0.50", narrative: "Ready" }),
        row({ name: "Second charge", lineItemId: "", subtotal: "25.25", narrative: "" }),
      ];

      const real = await POST(
        postRequest(
          buildForm({ file, fundingSourceId, rows, vendorName: "Acme Co", invoiceDate: "2095-03-01" }),
        ),
      );
      expect(real.status).toBe(200);
      expect(await real.json()).toEqual({ ok: true });

      // Looked up by the server-recomputed hash itself, not by filename — an earlier test in
      // this file also posts a file named "invoice.pdf", and filename is not unique.
      const [imported] = await db
        .select()
        .from(expenseImports)
        .where(and(eq(expenseImports.orgId, orgId), eq(expenseImports.sha256, realSha256)));
      expect(imported).toBeDefined();
      // The server's own hash of the bytes it received — the route accepts no client-supplied
      // sha256 field at all, so this proves the stored value is computed here, not trusted.
      expect(imported.sha256).toBe(realSha256);
      expect(imported.filename).toBe("invoice.pdf");
      expect(imported.pageCount).toBe(2);
      expect(imported.month).toBe("2095-03");
      expect(imported.fundingSourceId).toBe(fundingSourceId);
      expect(imported.vendorName).toBe("Acme Co");
      expect(imported.invoiceDate).toBe("2095-03-01");

      const drafts = await db
        .select()
        .from(expenseDrafts)
        .where(eq(expenseDrafts.importId, imported.id))
        .orderBy(expenseDrafts.sortOrder);
      expect(drafts).toHaveLength(2);

      expect(drafts[0].name).toBe("First charge");
      expect(drafts[0].month).toBe("2095-03");
      expect(drafts[0].date).toBe("2095-01-05");
      expect(drafts[0].description).toBe("One widget");
      expect(drafts[0].lineItemId).toBe(lineItemId);
      expect(drafts[0].paymentSource).toBe("Operating account");
      expect(drafts[0].subtotalCents).toBe(5000);
      expect(drafts[0].taxCents).toBe(100);
      expect(drafts[0].feesCents).toBe(50);
      expect(drafts[0].narrative).toBe("Ready");
      expect(drafts[0].sortOrder).toBe(0);

      expect(drafts[1].name).toBe("Second charge");
      expect(drafts[1].lineItemId).toBeNull();
      expect(drafts[1].narrative).toBeNull(); // blank narrative is stored as null
      expect(drafts[1].subtotalCents).toBe(2525);
      expect(drafts[1].sortOrder).toBe(1);

      const stored = await storage().get(imported.s3Key);
      expect(Buffer.from(stored).length).toBe(bytes.byteLength);
    });
  });

  describe("checkDuplicateInvoiceAction", () => {
    it("no duplicate returns null", async () => {
      asSession(orgId, userId, "2095-07");
      const result = await checkDuplicateInvoiceAction(fundingSourceId, "a".repeat(64));
      expect(result).toEqual({ ok: true, data: null });
    });

    it("a duplicate invoice is warned about but the create route still succeeds (never blocks)", async () => {
      asSession(orgId, userId, "2095-04");
      const bytes = await pdfBytes(1);
      const sha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");

      const first = await POST(
        postRequest(
          buildForm({
            file: new File([new Uint8Array(bytes)], "dup.pdf", { type: "application/pdf" }),
            fundingSourceId,
            rows: [row({ name: "Dup line one" })],
          }),
        ),
      );
      expect(first.status).toBe(200);

      const warned = await checkDuplicateInvoiceAction(fundingSourceId, sha256);
      expect(warned.ok).toBe(true);
      expect(warned.ok && warned.data).not.toBeNull();
      if (warned.ok && warned.data) expect(warned.data.by).not.toBeNull();

      // Posting the identical bytes again succeeds — a warning, never a block.
      const second = await POST(
        postRequest(
          buildForm({
            file: new File([new Uint8Array(bytes)], "dup.pdf", { type: "application/pdf" }),
            fundingSourceId,
            rows: [row({ name: "Dup line two" })],
          }),
        ),
      );
      expect(second.status).toBe(200);
    });

    it("a removed uploader gives by: null", async () => {
      asSession(orgId, userId, "2095-05");
      const bytes = await pdfBytes(1);
      const sha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");

      const [tempUser] = await db
        .insert(users)
        .values({
          orgId,
          email: `temp-uploader-${Date.now()}@example.test`,
          passwordHash: "x",
          role: "admin",
        })
        .returning({ id: users.id });

      asSession(orgId, tempUser.id, "2095-05");
      const created = await POST(
        postRequest(
          buildForm({
            file: new File([new Uint8Array(bytes)], "orphan.pdf", { type: "application/pdf" }),
            fundingSourceId,
            rows: [row({ name: "Orphan line" })],
          }),
        ),
      );
      expect(created.status).toBe(200);

      await db.delete(users).where(eq(users.id, tempUser.id));

      asSession(orgId, userId, "2095-05");
      const result = await checkDuplicateInvoiceAction(fundingSourceId, sha256);
      expect(result.ok).toBe(true);
      expect(result.ok && result.data?.by).toBeNull();
    });
  });

  describe("loadInvoiceMatchContext", () => {
    it("returns recurring items and vendors shaped for matchInvoiceLine", async () => {
      await db.insert(recurringItems).values({
        orgId,
        name: "Monthly Widget Fee",
        lineItemId,
        defaultDescription: "Recurring widget",
        defaultNarrative: "Every month",
        defaultPaymentSource: "Operating account",
        sortOrder: 0,
      });
      await db.insert(vendorDefaults).values({
        orgId,
        name: "Acme Vendor",
        defaultLineItemId: lineItemId,
        defaultDescription: "From Acme",
        defaultPaymentSource: "Operating account",
      });

      const context = await loadInvoiceMatchContext(orgId);
      const recurring = context.recurringItems.find((r) => r.name === "Monthly Widget Fee");
      expect(recurring?.lineItemId).toBe(lineItemId);
      expect(recurring?.defaultNarrative).toBe("Every month");
      const vendor = context.vendors.find((v) => v.name === "Acme Vendor");
      expect(vendor?.defaultLineItemId).toBe(lineItemId);
    });
  });

  describe("saving a charge as a real expense, not a draft (Phase 14)", () => {
    it("writes a real expense with its own reference number, its receipt and its history", async () => {
      const file = await pdfFile();
      const response = await POST(
        postRequest(
          buildForm({
            file,
            fundingSourceId,
            rows: [
              row({ name: "Straight to the books", kind: "expense", narrative: "Checked on the day." }),
              row({ name: "Still to check", kind: "draft", narrative: "" }),
            ],
          }),
        ),
      );
      expect(response.status).toBe(200);

      // The expense is real: it counts, so it has a number, and the number came from the
      // month counter rather than anywhere else.
      const made = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.orgId, orgId), eq(expenses.name, "Straight to the books")));
      expect(made).toHaveLength(1);
      expect(made[0].referenceSeq).toBeGreaterThanOrEqual(1);
      expect(made[0].narrative).toBe("Checked on the day.");
      // Never defaulted: these have no column default precisely so they cannot be forgotten.
      expect(typeof made[0].taxReimbursable).toBe("boolean");
      expect(typeof made[0].feesReimbursable).toBe("boolean");

      // The other row is still only a draft, so the two kinds really were split. Checked by
      // containment: earlier tests in this file leave their own drafts on the org.
      const { drafts } = await countRows(orgId);
      expect(drafts.map((d) => d.name)).toContain("Still to check");
      expect(drafts.map((d) => d.name)).not.toContain("Straight to the books");

      // The invoice became its receipt, and the history says where it came from (ticket §7).
      const docs = await db
        .select()
        .from(expenseDocuments)
        .where(eq(expenseDocuments.expenseId, made[0].id));
      expect(docs).toHaveLength(1);
      expect(docs[0].kind).toBe("receipt");
      expect(docs[0].status).toBe("attached");

      const events = await db
        .select()
        .from(expenseAuditEvents)
        .where(eq(expenseAuditEvents.expenseId, made[0].id));
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe("created");
      expect((events[0].afterData as Record<string, unknown>).fromInvoice).toBe(true);
    });

    it("refuses a charge saved as an expense while it is still missing a narrative, and writes nothing", async () => {
      const before = await countRows(orgId);
      const beforeExpenses = await db.select().from(expenses).where(eq(expenses.orgId, orgId));

      const response = await POST(
        postRequest(
          buildForm({
            file: await pdfFile(),
            fundingSourceId,
            rows: [row({ name: "Unfinished", kind: "expense", narrative: "" })],
          }),
        ),
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      // Named, because the person is looking at a list of charges.
      expect(body.error).toContain("Unfinished");

      const after = await countRows(orgId);
      expect(after.imports).toHaveLength(before.imports.length);
      expect(after.drafts).toHaveLength(before.drafts.length);
      const afterExpenses = await db.select().from(expenses).where(eq(expenses.orgId, orgId));
      expect(afterExpenses).toHaveLength(beforeExpenses.length);
    });

    it("refuses a charge saved as an expense with no line item", async () => {
      const response = await POST(
        postRequest(
          buildForm({
            file: await pdfFile(),
            fundingSourceId,
            rows: [row({ name: "No line item", kind: "expense", lineItemId: "", narrative: "Written." })],
          }),
        ),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("No line item");
    });
  });

  describe("the server is the only authority (nothing trusts the screen)", () => {
    // Every one of these is something the check screen also refuses. The screen refusing it is
    // a courtesy; these posts go straight at the route with no screen involved, which is what
    // a bypassed, scripted or stale client actually looks like.

    it("refuses a charge marked as an expense that is missing its narrative, however it was posted", async () => {
      const response = await POST(
        postRequest(
          buildForm({
            file: await pdfFile(),
            fundingSourceId,
            rows: [row({ name: "Bypassed", kind: "expense", narrative: "" })],
          }),
        ),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("Bypassed");
    });

    it("refuses an unknown payment source, which the screen only ever offers from a list", async () => {
      const response = await POST(
        postRequest(
          buildForm({
            file: await pdfFile(),
            fundingSourceId,
            rows: [row({ paymentSource: "Cash under the table" })],
          }),
        ),
      );
      expect(response.status).toBe(400);
    });

    it("refuses a line item from another funding source, which the screen never lists", async () => {
      const [otherSource] = await db
        .insert(fundingSources)
        .values({ orgId, name: `Other ${Date.now()}`, type: "grant", sortOrder: 9, ...ORIGINAL_RULES })
        .returning({ id: fundingSources.id });
      const [foreign] = await db
        .insert(lineItems)
        .values({
          orgId,
          fundingSourceId: otherSource.id,
          name: "Elsewhere",
          scheduledValueCents: 1000,
          sortOrder: 0,
        })
        .returning({ id: lineItems.id });

      const response = await POST(
        postRequest(
          buildForm({
            file: await pdfFile(),
            fundingSourceId,
            rows: [row({ lineItemId: foreign.id })],
          }),
        ),
      );
      expect(response.status).toBe(400);
    });

    it("refuses an empty row set and a malformed one", async () => {
      for (const rows of [[], [{ nonsense: true }]]) {
        const response = await POST(
          postRequest(buildForm({ file: await pdfFile(), fundingSourceId, rows })),
        );
        expect(response.status).toBe(400);
      }
    });

    it("refuses a kind it does not recognise, rather than defaulting it to something", async () => {
      // A row claiming some third kind must not quietly become an expense.
      const response = await POST(
        postRequest(
          postFormWithRawRows(await pdfFile(), fundingSourceId, [
            { ...row(), kind: "approved" },
          ]),
        ),
      );
      expect(response.status).toBe(400);
    });

    it("ignores a month sent by the client and uses the session's own", async () => {
      // `month` is never read from the form: a posted month could put records in a month the
      // person does not have open, or in a locked one.
      const form = buildForm({
        file: await pdfFile(),
        fundingSourceId,
        rows: [row({ name: "Month from the session" })],
      });
      form.set("month", "2090-01");
      const response = await POST(postRequest(form));
      expect(response.status).toBe(200);

      const { drafts } = await countRows(orgId);
      const made = drafts.find((d) => d.name === "Month from the session");
      expect(made?.month).not.toBe("2090-01");
    });
  });
});
