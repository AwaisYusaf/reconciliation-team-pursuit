/**
 * `GET /api/downloads/monthly-summary?format=pdf` when `convertDocxToPdf` fails (Phase 11
 * §7.4, P13, PHASE-11.md §10 I-35).
 *
 * Kept in its own file: `convertDocxToPdf` must be mocked at the module level for this case,
 * which would otherwise also mock it for `download-route.integration.test.ts`'s real-conversion
 * assertions since `vi.mock` hoists to the top of whatever file it's declared in.
 *
 * Skipped when DATABASE_URL is absent.
 */
vi.mock("@/src/services/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/src/generation/docx-to-pdf", () => ({ convertDocxToPdf: vi.fn() }));

import { rm } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("monthly summary PDF download failure (integration, I-35)", async () => {
  const { db } = await import("@/src/db");
  const { monthlySummaries, organizations, users } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { getSession } = await import("@/src/services/auth/session");
  const { UI } = await import("@/src/domain/strings");
  const { clearAll: clearRateLimit } = await import("@/src/services/rate-limit");
  const { convertDocxToPdf } = await import("@/src/generation/docx-to-pdf");

  const { GET } = await import("@/app/api/downloads/monthly-summary/route");

  const getSessionMock = vi.mocked(getSession);
  const convertMock = vi.mocked(convertDocxToPdf);

  const createdOrgIds: string[] = [];
  afterAll(async () => {
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
      await rm(path.join(process.cwd(), ".storage", "org", id), { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    clearRateLimit();
    convertMock.mockReset();
  });

  it("503 with UI.summaryPdfFailed (text/plain) when conversion throws; the docx path still 200s", async () => {
    const org = await createTestOrg({ name: `PDF fail ${Date.now()}-${Math.random()}` });
    createdOrgIds.push(org.orgId);
    await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, org.orgId));
    const [user] = await db
      .insert(users)
      .values({
        orgId: org.orgId,
        email: `pdf-${Date.now()}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });

    await db.insert(monthlySummaries).values({
      orgId: org.orgId,
      fundingSourceId: org.fundingSourceId,
      month: "2098-07",
      contentMarkdown: "## Overview\nNothing to report this month.",
      version: 1,
      expensesFingerprint: "0".repeat(64),
      writtenAt: new Date(),
      model: "gpt-5.6-terra",
    });

    getSessionMock.mockResolvedValue({
      orgId: org.orgId,
      userId: user.id,
      email: "e@example.com",
      role: "admin",
      orgName: "Org",
      docName: "Doc",
      activeMonth: "2098-07",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation_ai",
    });

    convertMock.mockRejectedValue(new Error("soffice exploded"));

    function req(format: string) {
      const url = new URL("http://localhost/api/downloads/monthly-summary");
      url.searchParams.set("month", "2098-07");
      url.searchParams.set("source", org.fundingSourceId);
      url.searchParams.set("format", format);
      return new Request(url, { headers: { "Sec-Fetch-Site": "same-origin" } });
    }

    const pdfRes = await GET(req("pdf"));
    expect(pdfRes.status).toBe(503);
    expect(pdfRes.headers.get("Content-Type")).toContain("text/plain");
    expect((await pdfRes.text()).trim()).toBe(UI.summaryPdfFailed);
    expect(convertMock).toHaveBeenCalledTimes(1);

    const docxRes = await GET(req("docx"));
    expect(docxRes.status).toBe(200);
  });
});
