/**
 * `GET /api/downloads/monthly-summary` against a real Postgres (Phase 11 §6, §7.4, P13,
 * PHASE-11.md §10 I-20, I-32).
 *
 * Every guard in the route, in the order the route checks them, plus the docx and PDF the route
 * actually serves (the PDF case skips without LibreOffice). Conversion failure (I-35) is in
 * `download-route-pdf-failure.integration.test.ts`, because it mocks the converter module-wide.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

vi.mock("@/src/services/auth/session", () => ({ getSession: vi.fn() }));

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const MONTH = "2098-06"; // far future, avoids clashing with real data
let monthSeq = 0;
/** A fresh month key per test, so the unique (org, source, month) row never collides. */
function freshMonth(): string {
  monthSeq += 1;
  const mm = String((monthSeq % 12) + 1).padStart(2, "0");
  const year = 2098 + Math.floor(monthSeq / 12);
  return `${year}-${mm}`;
}

describe.skipIf(!hasDatabase)("monthly summary download route (integration, Phase 11)", async () => {
  const { db } = await import("@/src/db");
  const { fundingSources, monthlySummaries, organizations, users } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { getSession } = await import("@/src/services/auth/session");
  const { UI } = await import("@/src/domain/strings");
  const { clearAll: clearRateLimit } = await import("@/src/services/rate-limit");
  const { lockMonth } = await import("@/src/modules/packet/lock");

  const { GET } = await import("@/app/api/downloads/monthly-summary/route");
  const conversionOk = await (await import("@/src/generation/docx-to-pdf")).conversionAvailable();

  const getSessionMock = vi.mocked(getSession);

  const createdOrgIds: string[] = [];
  afterAll(async () => {
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
      await rm(path.join(process.cwd(), ".storage", "org", id), { recursive: true, force: true });
    }
  });

  async function insertUser(orgId: string, role: "admin" | "manager" = "admin") {
    const [row] = await db
      .insert(users)
      .values({
        orgId,
        email: `dl-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role,
      })
      .returning({ id: users.id });
    return row.id;
  }

  function sessionContext(orgId: string, userId: string, overrides: Record<string, unknown> = {}) {
    return {
      orgId,
      userId,
      email: "e@example.com",
      role: "admin" as const,
      orgName: "Org",
      docName: "Doc",
      activeMonth: MONTH,
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation_ai" as const,
      ...overrides,
    };
  }

  function asUser(orgId: string, userId: string, overrides: Record<string, unknown> = {}) {
    getSessionMock.mockResolvedValue(sessionContext(orgId, userId, overrides));
  }

  async function makeOrg(name: string, plan: "reconciliation" | "reconciliation_ai" = "reconciliation_ai") {
    const org = await createTestOrg({ name: `${name} ${Date.now()}-${Math.random()}` });
    createdOrgIds.push(org.orgId);
    await db.update(organizations).set({ plan }).where(eq(organizations.id, org.orgId));
    const userId = await insertUser(org.orgId);
    return { ...org, userId };
  }

  async function insertSummary(
    orgId: string,
    sourceId: string,
    month: string,
    overrides: Partial<typeof monthlySummaries.$inferInsert> = {},
  ) {
    await db.insert(monthlySummaries).values({
      orgId,
      fundingSourceId: sourceId,
      month,
      contentMarkdown: "## Overview\nNothing to report this month.",
      version: 1,
      expensesFingerprint: "0".repeat(64),
      writtenAt: new Date(),
      model: "gpt-5.6-terra",
      ...overrides,
    });
  }

  function request(params: Record<string, string>, headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin" }) {
    const url = new URL("http://localhost/api/downloads/monthly-summary");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return new Request(url, { headers });
  }

  beforeEach(() => {
    clearRateLimit();
  });

  it("401 when not signed in", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET(request({ month: MONTH, source: "any", format: "docx" }));
    expect(res.status).toBe(401);
  });

  describe("cross-site guard", () => {
    it("403 for a cross-site Sec-Fetch-Site", async () => {
      const org = await makeOrg("Cross-site");
      asUser(org.orgId, org.userId);
      const res = await GET(
        request({ month: MONTH, source: org.fundingSourceId, format: "docx" }, { "Sec-Fetch-Site": "cross-site" }),
      );
      expect(res.status).toBe(403);
    });

    it.each(["same-origin", "none"])("%s is allowed through the site check", async (site) => {
      const org = await makeOrg("Site allowed");
      await insertSummary(org.orgId, org.fundingSourceId, MONTH);
      asUser(org.orgId, org.userId);
      const res = await GET(
        request({ month: MONTH, source: org.fundingSourceId, format: "docx" }, { "Sec-Fetch-Site": site }),
      );
      expect(res.status).toBe(200);
    });

    it("an absent Sec-Fetch-Site header is allowed through", async () => {
      const org = await makeOrg("Site absent");
      await insertSummary(org.orgId, org.fundingSourceId, MONTH);
      asUser(org.orgId, org.userId);
      const res = await GET(request({ month: MONTH, source: org.fundingSourceId, format: "docx" }, {}));
      expect(res.status).toBe(200);
    });
  });

  it("429 after 6 calls in a minute, with Retry-After", async () => {
    const org = await makeOrg("Rate limited");
    await insertSummary(org.orgId, org.fundingSourceId, MONTH);
    asUser(org.orgId, org.userId);

    for (let i = 0; i < 6; i += 1) {
      const res = await GET(request({ month: MONTH, source: org.fundingSourceId, format: "docx" }));
      expect(res.status).toBe(200);
    }
    const seventh = await GET(request({ month: MONTH, source: org.fundingSourceId, format: "docx" }));
    expect(seventh.status).toBe(429);
    expect(seventh.headers.get("Retry-After")).toBeTruthy();
  });

  it("403 with the plan note on the base plan", async () => {
    const org = await makeOrg("Base plan", "reconciliation");
    asUser(org.orgId, org.userId);
    const res = await GET(request({ month: MONTH, source: org.fundingSourceId, format: "docx" }));
    expect(res.status).toBe(403);
    expect((await res.text()).trim()).toBe(UI.summaryPlanNote);
  });

  it("404 for another org's funding source id, even when that org's summary really exists (org scoping, not just absence)", async () => {
    const orgA = await makeOrg("Cross org A");
    const orgB = await makeOrg("Cross org B");
    const month = freshMonth();
    await insertSummary(orgA.orgId, orgA.fundingSourceId, month); // a real row for org A, not a miss
    asUser(orgB.orgId, orgB.userId);
    const res = await GET(request({ month, source: orgA.fundingSourceId, format: "docx" }));
    expect(res.status).toBe(404);
  });

  it("404 for a malformed (non-uuid) source id, and for a missing one", async () => {
    const org = await makeOrg("Malformed source");
    asUser(org.orgId, org.userId);
    const malformed = await GET(request({ month: MONTH, source: "not-a-uuid", format: "docx" }));
    expect(malformed.status).toBe(404);
    const missing = await GET(request({ month: MONTH, format: "docx" }));
    expect(missing.status).toBe(404);
  });

  it("400 for an invalid month", async () => {
    const org = await makeOrg("Invalid month");
    asUser(org.orgId, org.userId);
    const res = await GET(request({ month: "2098-13", source: org.fundingSourceId, format: "docx" }));
    expect(res.status).toBe(400);
  });

  it("400 for an unknown or missing format", async () => {
    const org = await makeOrg("Bad format");
    asUser(org.orgId, org.userId);
    const unknown = await GET(request({ month: MONTH, source: org.fundingSourceId, format: "xlsx" }));
    expect(unknown.status).toBe(400);
    const missing = await GET(request({ month: MONTH, source: org.fundingSourceId }));
    expect(missing.status).toBe(400);
  });

  it("404 when there is no summary for the month", async () => {
    const org = await makeOrg("No summary");
    asUser(org.orgId, org.userId);
    const res = await GET(request({ month: freshMonth(), source: org.fundingSourceId, format: "docx" }));
    expect(res.status).toBe(404);
  });

  describe("a successful docx download", () => {
    it("200 with the right content-type, filename (no source name — single source), nosniff, private no-store, and PK body", async () => {
      const org = await makeOrg("Success docx");
      const month = freshMonth();
      await insertSummary(org.orgId, org.fundingSourceId, month);
      asUser(org.orgId, org.userId);

      const res = await GET(request({ month, source: org.fundingSourceId, format: "docx" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");

      const disposition = res.headers.get("Content-Disposition") ?? "";
      expect(disposition).toContain("Monthly Summary.docx");
      // Single-source org: no funding source name inserted into the filename.
      expect(disposition).not.toContain("Source 1");

      const buffer = Buffer.from(await res.arrayBuffer());
      expect(buffer.subarray(0, 2).toString()).toBe("PK");
    });

    it("adds the source name to the filename/title once the org has a second source, even an archived one", async () => {
      const org = await makeOrg("Multi source");
      const month = freshMonth();
      await insertSummary(org.orgId, org.fundingSourceId, month);
      await db.insert(fundingSources).values({
        orgId: org.orgId,
        name: "Archived Grant",
        type: "grant",
        sortOrder: 1,
        taxReimbursable: false,
        feesReimbursable: true,
        archivedAt: new Date(),
      });
      asUser(org.orgId, org.userId);

      const res = await GET(request({ month, source: org.fundingSourceId, format: "docx" }));
      expect(res.status).toBe(200);
      const disposition = res.headers.get("Content-Disposition") ?? "";
      expect(disposition).toContain("Source 1");
    });

    it.skipIf(!conversionOk)("pdf: 200, application/pdf, .pdf filename with the same stem, %PDF body", async () => {
      const org = await makeOrg("Success pdf");
      const month = freshMonth();
      await insertSummary(org.orgId, org.fundingSourceId, month);
      asUser(org.orgId, org.userId);

      const res = await GET(request({ month, source: org.fundingSourceId, format: "pdf" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      const { monthLabel } = await import("@/src/domain/dates");
      expect(res.headers.get("Content-Disposition") ?? "").toContain(
        `${monthLabel(month as never)} Monthly Summary.pdf`,
      );
      const buffer = Buffer.from(await res.arrayBuffer());
      expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
      expect(res.headers.get("Content-Length")).toBe(String(buffer.byteLength));
    }, 200_000);

    it("a manager session can download", async () => {
      const org = await makeOrg("Manager session");
      const managerId = await insertUser(org.orgId, "manager");
      const month = freshMonth();
      await insertSummary(org.orgId, org.fundingSourceId, month);
      asUser(org.orgId, managerId, { role: "manager" });

      const res = await GET(request({ month, source: org.fundingSourceId, format: "docx" }));
      expect(res.status).toBe(200);
    });

    it("serves a locked month's summary (no lock/archive check)", async () => {
      const org = await makeOrg("Locked month");
      const month = freshMonth();
      await insertSummary(org.orgId, org.fundingSourceId, month);
      const locked = await lockMonth({
        orgId: org.orgId,
        userId: org.userId,
        fundingSourceId: org.fundingSourceId,
        month,
        file: await pdfFile(),
      });
      expect(locked.ok).toBe(true);
      asUser(org.orgId, org.userId);

      const res = await GET(request({ month, source: org.fundingSourceId, format: "docx" }));
      expect(res.status).toBe(200);
    });

    it("serves an archived source's summary", async () => {
      const org = await makeOrg("Archived source");
      const month = freshMonth();
      await insertSummary(org.orgId, org.fundingSourceId, month);
      await db.update(fundingSources).set({ archivedAt: new Date() }).where(eq(fundingSources.id, org.fundingSourceId));
      asUser(org.orgId, org.userId);

      const res = await GET(request({ month, source: org.fundingSourceId, format: "docx" }));
      expect(res.status).toBe(200);
    });

    it("downloads the SAVED content, not some other text", async () => {
      const org = await makeOrg("Saved content");
      const month = freshMonth();
      const marker = `Distinctive marker ${Math.random().toString(36).slice(2)}`;
      await insertSummary(org.orgId, org.fundingSourceId, month, { contentMarkdown: `## Overview\n${marker}` });
      asUser(org.orgId, org.userId);

      const res = await GET(request({ month, source: org.fundingSourceId, format: "docx" }));
      expect(res.status).toBe(200);
      const buffer = Buffer.from(await res.arrayBuffer());
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const xml = await zip.file("word/document.xml")!.async("string");
      expect(xml).toContain(marker);
    });

    it("uses the funding source's docName override, and an empty-string override, over the org's docName", async () => {
      // A distinctive, known org docName (rather than makeOrg's default of reusing the
      // generated org name) so the assertions below can prove the *source's* docName is what
      // actually won, not just eyeball a substring.
      const orgDocName = `Org Doc Name ${Date.now()}-${Math.random()}`;
      const testOrg = await createTestOrg({ name: `Doc name override ${Date.now()}-${Math.random()}`, docName: orgDocName });
      createdOrgIds.push(testOrg.orgId);
      await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, testOrg.orgId));
      const userId = await insertUser(testOrg.orgId);
      const org = { ...testOrg, userId };

      const month = freshMonth();
      await insertSummary(org.orgId, org.fundingSourceId, month);
      await db.update(fundingSources).set({ docName: "Custom Source Doc Name" }).where(eq(fundingSources.id, org.fundingSourceId));
      asUser(org.orgId, org.userId);

      const overridden = await GET(request({ month, source: org.fundingSourceId, format: "docx" }));
      expect(overridden.status).toBe(200);
      let disposition = overridden.headers.get("Content-Disposition") ?? "";
      expect(disposition).toContain("Custom Source Doc Name");
      expect(disposition).not.toContain(orgDocName);

      // Empty string is a deliberate override, distinct from null — `??` and not `||` (see
      // `loadSummaryForDownload`). With `||` this would fall back to the org's docName instead
      // of staying empty.
      const emptyMonth = freshMonth();
      await insertSummary(org.orgId, org.fundingSourceId, emptyMonth);
      await db.update(fundingSources).set({ docName: "" }).where(eq(fundingSources.id, org.fundingSourceId));
      const empty = await GET(request({ month: emptyMonth, source: org.fundingSourceId, format: "docx" }));
      expect(empty.status).toBe(200);
      disposition = empty.headers.get("Content-Disposition") ?? "";
      // With an empty docName override and a single source, the title is just "<month> Monthly
      // Summary" — the org's own docName must not have leaked back in.
      expect(disposition).not.toContain(orgDocName);
      const { monthLabel } = await import("@/src/domain/dates");
      expect(disposition).toContain(`${monthLabel(emptyMonth as never)} Monthly Summary.docx`);
    });
  });

  async function pdfFile(name = "signed.pdf"): Promise<File> {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
  }

  describe("I-32: a monthly summary never affects the packet's inputs", () => {
    // `packetContents` is a pure function of page counts and line items taken from this snapshot,
    // so an unchanged snapshot (and its hash) is what proves the packet is unchanged; the
    // import-isolation test covers the route and builder never reaching packet code.
    it("the month snapshot and its inputsHash are unchanged before/after a summary exists", async () => {
      const { loadMonthSnapshot } = await import("@/src/generation/month-snapshot");
      const { inputsHash } = await import("@/src/generation/cache-key");

      const org = await makeOrg("I-32 isolation");
      const month = freshMonth();

      const before = await loadMonthSnapshot(org.orgId, org.fundingSourceId, month as never);

      await insertSummary(org.orgId, org.fundingSourceId, month, {
        contentMarkdown: "## Overview\nA brand new summary that did not exist before.",
      });

      const after = await loadMonthSnapshot(org.orgId, org.fundingSourceId, month as never);
      expect(after).toEqual(before);
      expect(inputsHash({ snapshot: after, generatorVersion: "test-1" })).toBe(
        inputsHash({ snapshot: before, generatorVersion: "test-1" }),
      );
    });
  });
});
