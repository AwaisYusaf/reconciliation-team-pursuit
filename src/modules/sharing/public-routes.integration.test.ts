/**
 * The shared link's routes against a real Postgres (PHASE-12 §6, §10 I-13..I-17, I-19..I-21, I-23):
 * `POST /s/{token}/unlock` and `GET`/`HEAD /s/{token}/{filename}`. The page itself (`/s/{token}`)
 * renders through Next and is checked in the browser pass (B-2, B-3).
 *
 * Skipped when DATABASE_URL is absent.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("shared link routes (integration, PHASE-12)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, generatedArtifacts, lineItems, organizations, sharedLinks, users } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { actionSession } = await import("@/src/lib/action-session");
  const { clearAll: clearRateLimit } = await import("@/src/services/rate-limit");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { ingestExpenseDocument } = await import("@/src/services/storage/documents");
  const { storage } = await import("@/src/services/storage/driver");
  const { UI } = await import("@/src/domain/strings");
  const { createSharedLinkAction, stopSharingAction } = await import("./actions");
  const { POST: unlockPost } = await import("@/app/s/[token]/unlock/route");
  const { GET: fileGet, HEAD: fileHead } = await import("@/app/s/[token]/[filename]/route");

  let orgId: string;
  let sourceId: string;
  let itemId: string;
  let userId: string;

  let monthCounter = 0;
  function freshMonth(): string {
    monthCounter += 1;
    const month = 1 + (monthCounter % 12);
    const year = 2078 + Math.floor(monthCounter / 12);
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  async function documentedMonth(): Promise<string> {
    const month = freshMonth();
    const [row] = await db
      .insert(expenses)
      .values({
        orgId, fundingSourceId: sourceId, lineItemId: itemId, month, date: `${month}-05`,
        name: "Staples", narrative: "Office supplies.", paymentSource: "Cash", subtotalCents: 1_000,
        taxReimbursable: false, feesReimbursable: true, sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, sourceId, month),
      })
      .returning({ id: expenses.id });
    const jpeg = await sharp({ create: { width: 60, height: 60, channels: 3, background: { r: 9, g: 9, b: 9 } } }).jpeg().toBuffer();
    for (const scope of ["proof", "receipt"] as const) {
      const result = await ingestExpenseDocument({ orgId, expenseId: row.id, scope, file: new File([new Uint8Array(jpeg)], `${scope}.jpg`, { type: "image/jpeg" }) });
      if (!result.ok) throw new Error(result.error);
    }
    return month;
  }

  /** Share and return the row. */
  async function shared(kind: "packet" | "summary", password: string | null = null) {
    const month = await documentedMonth();
    const result = await createSharedLinkAction({ fundingSourceId: sourceId, month, kind, password, confirmedDeletions: false });
    if (!result.ok) throw new Error(result.error);
    const [row] = await db
      .select()
      .from(sharedLinks)
      .where(and(eq(sharedLinks.orgId, orgId), eq(sharedLinks.month, month)));
    return row;
  }

  function fileRequest(token: string, filename: string, options: { method?: "GET" | "HEAD"; cookie?: string; ip?: string } = {}) {
    const headers = new Headers({ "x-forwarded-for": options.ip ?? "203.0.113.10" });
    if (options.cookie) headers.set("cookie", options.cookie);
    return new NextRequest(`http://localhost/s/${token}/${encodeURIComponent(filename)}`, { method: options.method ?? "GET", headers });
  }

  function context(token: string, filename = "x") {
    return { params: Promise.resolve({ token, filename }) };
  }

  function unlockRequest(token: string, password: unknown, options: { ip?: string; origin?: string } = {}) {
    const body = JSON.stringify({ password });
    return new NextRequest(`http://localhost/s/${token}/unlock`, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        host: "localhost",
        origin: options.origin ?? "http://localhost",
        "x-forwarded-for": options.ip ?? "203.0.113.20",
      },
    });
  }

  /** `name=value` of the Set-Cookie header, as a browser would send it back. */
  function cookieFrom(response: Response): string {
    const header = response.headers.get("set-cookie") ?? "";
    return header.split(";")[0];
  }

  beforeAll(async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const org = await createTestOrg({ name: `Share Routes ${Date.now()}`, docName: "Share Routes" });
    orgId = org.orgId;
    sourceId = org.fundingSourceId;
    const [item] = await db.insert(lineItems).values({ orgId, fundingSourceId: sourceId, name: "A item", scheduledValueCents: 100_000, sortOrder: 0 }).returning({ id: lineItems.id });
    itemId = item.id;
    const [user] = await db.insert(users).values({ orgId, email: `routes-${Date.now()}@example.test`, passwordHash: await hashPassword("original-password-here"), role: "manager" }).returning({ id: users.id });
    userId = user.id;
  }, 30_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await rm(path.join(process.cwd(), ".storage", "org", orgId), { recursive: true, force: true });
  });

  beforeEach(() => {
    clearRateLimit();
    vi.mocked(actionSession).mockResolvedValue({
      orgId, userId, email: "e@example.com", role: "manager", orgName: "Org", docName: "Org",
      activeMonth: "2078-01", activeFundingSourceId: null, onboarded: true, welcomeDismissed: true, plan: "reconciliation",
    } as Awaited<ReturnType<typeof actionSession>>);
  });

  it("I-13: the PDF is served inline and the workbook as a download, byte for byte, never cached or indexed", async () => {
    for (const kind of ["packet", "summary"] as const) {
      const row = await shared(kind);
      const [artifact] = await db.select().from(generatedArtifacts).where(eq(generatedArtifacts.id, row.artifactId));
      const stored = await storage().get(artifact.s3Key);

      const response = await fileGet(fileRequest(row.token, row.filename), context(row.token, row.filename));
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer()).equals(stored)).toBe(true);
      expect(response.headers.get("Content-Length")).toBe(String(stored.byteLength));
      expect(response.headers.get("Content-Disposition")).toBe(
        `${kind === "packet" ? "inline" : "attachment"}; filename="${row.filename}"; filename*=UTF-8''${row.filename}`,
      );
      expect(response.headers.get("Content-Type")).toBe(
        kind === "packet" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("X-Robots-Tag")).toMatch(/noindex/);
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Accept-Ranges")).toBe("none");
    }
  }, 120_000);

  it("I-13: the workbook's name is the Download Summary name", async () => {
    const row = await shared("summary");
    expect(row.filename).toMatch(/^Share_Routes_[A-Z][a-z]+_\d{4}_Summary\.xlsx$/);
  }, 60_000);

  it("I-14: opening a link many times writes nothing and never reads the whole file into memory", async () => {
    const row = await shared("packet");
    const rowsBefore = await db.select({ id: generatedArtifacts.id }).from(generatedArtifacts).where(eq(generatedArtifacts.orgId, orgId));
    const put = vi.spyOn(storage(), "put");
    const get = vi.spyOn(storage(), "get");

    for (let i = 0; i < 5; i += 1) {
      const response = await fileGet(fileRequest(row.token, row.filename), context(row.token));
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
    const writes = put.mock.calls.length;
    const reads = get.mock.calls.length;
    put.mockRestore();
    get.mockRestore();

    expect(writes).toBe(0);
    expect(reads).toBe(0);
    const rowsAfter = await db.select({ id: generatedArtifacts.id }).from(generatedArtifacts).where(eq(generatedArtifacts.orgId, orgId));
    expect(rowsAfter).toHaveLength(rowsBefore.length);
  }, 60_000);

  it("I-15: over HTTP — wrong, then too many after five, then another address still gets in with a cookie that opens the file", async () => {
    const row = await shared("packet", "right-password");

    // Locked: the file sends the visitor back to the password page.
    const locked = await fileGet(fileRequest(row.token, row.filename), context(row.token));
    expect(locked.status).toBe(303);
    expect(locked.headers.get("Location")).toBe(`/s/${row.token}`);

    for (let i = 1; i <= 4; i += 1) {
      const wrong = await unlockPost(unlockRequest(row.token, "nope"), context(row.token));
      expect(await wrong.json()).toEqual({ ok: false, error: UI.sharePasswordWrong });
    }
    const fifth = await unlockPost(unlockRequest(row.token, "nope"), context(row.token));
    expect(fifth.status).toBe(429);
    expect(await fifth.json()).toEqual({ ok: false, error: UI.shareTooManyTries });
    const rightButLate = await unlockPost(unlockRequest(row.token, "right-password"), context(row.token));
    expect(await rightButLate.json()).toEqual({ ok: false, error: UI.shareTooManyTries });

    const elsewhere = await unlockPost(unlockRequest(row.token, "right-password", { ip: "203.0.113.99" }), context(row.token));
    expect(await elsewhere.json()).toEqual({ ok: true, url: `/s/${row.token}/${encodeURIComponent(row.filename)}` });
    const setCookie = elsewhere.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(new RegExp(`Path=/s/${row.token}`, "i"));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);

    const opened = await fileGet(fileRequest(row.token, row.filename, { cookie: cookieFrom(elsewhere) }), context(row.token));
    expect(opened.status).toBe(200);
  }, 60_000);

  it("I-17: a stopped link sends the file URL back to its page", async () => {
    const row = await shared("summary");
    await stopSharingAction({ shareId: row.id });
    const response = await fileGet(fileRequest(row.token, row.filename), context(row.token));
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`/s/${row.token}`);
    const unlock = await unlockPost(unlockRequest(row.token, "anything"), context(row.token));
    expect(unlock.status).toBe(404);
    expect(await unlock.json()).toEqual({ ok: false, error: UI.shareUnavailable });
  }, 60_000);

  it("I-19: a password posted from another site is refused before it is checked", async () => {
    const row = await shared("summary", "right-password");
    const response = await unlockPost(unlockRequest(row.token, "right-password", { origin: "http://evil.example" }), context(row.token));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  }, 60_000);

  it("I-20: one address is refused after sixty opens in the window", async () => {
    const row = await shared("summary");
    for (let i = 0; i < 60; i += 1) {
      await fileHead(fileRequest(row.token, row.filename, { method: "HEAD", ip: "198.51.100.60" }), context(row.token));
    }
    const refused = await fileGet(fileRequest(row.token, row.filename, { ip: "198.51.100.60" }), context(row.token));
    expect(refused.status).toBe(429);
    expect(await refused.text()).toBe(UI.shareTooManyOpens);
    const other = await fileGet(fileRequest(row.token, row.filename, { ip: "198.51.100.61" }), context(row.token));
    expect(other.status).toBe(200);
  }, 60_000);

  it("I-21: HEAD answers from the size alone and never opens the object", async () => {
    const row = await shared("packet");
    const stream = vi.spyOn(storage(), "stream");
    const response = await fileHead(fileRequest(row.token, row.filename, { method: "HEAD" }), context(row.token));
    const opens = stream.mock.calls.length;
    stream.mockRestore();

    expect(response.status).toBe(200);
    expect(opens).toBe(0);
    expect(Number(response.headers.get("Content-Length"))).toBeGreaterThan(0);
    expect(await response.text()).toBe("");
  }, 60_000);

  it("I-23: unknown, malformed and stopped tokens get the same answer", async () => {
    const row = await shared("summary");
    await stopSharingAction({ shareId: row.id });
    const answers = [];
    for (const token of ["AAAAAAAAAAAA", "not-a-token", row.token]) {
      const response = await fileGet(fileRequest(token, "x.pdf"), context(token));
      answers.push([response.status, response.headers.get("Location")?.replace(token, "T"), await response.text()]);
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[1]).toEqual(answers[2]);
  }, 60_000);

  it("a missing stored object is a 503, never a rebuild", async () => {
    const row = await shared("summary");
    const [artifact] = await db.select().from(generatedArtifacts).where(eq(generatedArtifacts.id, row.artifactId));
    await storage().delete(artifact.s3Key);
    const put = vi.spyOn(storage(), "put");

    const response = await fileGet(fileRequest(row.token, row.filename), context(row.token));
    const head = await fileHead(fileRequest(row.token, row.filename, { method: "HEAD" }), context(row.token));
    const writes = put.mock.calls.length;
    put.mockRestore();

    expect(response.status).toBe(503);
    expect(await response.text()).toBe(UI.shareOpenFailed);
    expect(head.status).toBe(503);
    expect(writes).toBe(0);
  }, 60_000);
});
