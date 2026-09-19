/**
 * Sharing's server surface against a real Postgres (PHASE-12 §5, §10 I-1..I-12, I-15..I-18, I-22).
 *
 * The actions are called directly with the session mocked; the POST routes that wrap the long
 * ones only add origin and size guards (`json-request.ts`). The public lookups are exercised at
 * function level here and through their routes in `public-routes.integration.test.ts`.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("sharing actions and public lookup (integration, PHASE-12)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, fundingSources, generatedArtifacts, lineItems, organizations, sharedLinks, users } =
    await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { actionSession } = await import("@/src/lib/action-session");
  const { clearAll: clearRateLimit } = await import("@/src/services/rate-limit");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { ingestExpenseDocument, ingestMonthDocument } = await import("@/src/services/storage/documents");
  const { storage } = await import("@/src/services/storage/driver");
  const { lockMonth } = await import("@/src/modules/packet/lock");
  const { prepareMonthOutput, resolveMonthOutput } = await import("@/src/modules/packet/month-output");
  const { UI } = await import("@/src/domain/strings");
  const actions = await import("./actions");
  const { loadSharedLinks } = await import("./queries");
  const { loadPublicShare, openShare, unlockSharedFile } = await import("./public");
  const { beginShareBuild, endShareBuild, shareBuildKey } = await import("./single-flight");
  const { generateShareToken } = await import("./token");

  const sessionMock = vi.mocked(actionSession);

  type Org = { orgId: string; sourceId: string; itemId: string; userId: string };
  const createdOrgIds: string[] = [];

  let monthCounter = 0;
  function freshMonth(): string {
    monthCounter += 1;
    const month = 1 + (monthCounter % 12);
    const year = 2081 + Math.floor(monthCounter / 12);
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  async function makeOrg(name: string, role: "admin" | "manager" = "admin"): Promise<Org> {
    const org = await createTestOrg({ name: `${name} ${Date.now()}-${Math.random()}`, docName: name });
    createdOrgIds.push(org.orgId);
    const [item] = await db
      .insert(lineItems)
      .values({ orgId: org.orgId, fundingSourceId: org.fundingSourceId, name: "A item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    const [user] = await db
      .insert(users)
      .values({
        orgId: org.orgId,
        email: `share-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        name: "Misty",
        passwordHash: await hashPassword("original-password-here"),
        role,
      })
      .returning({ id: users.id });
    return { orgId: org.orgId, sourceId: org.fundingSourceId, itemId: item.id, userId: user.id };
  }

  function as(org: Org, role: "admin" | "manager" = "admin") {
    sessionMock.mockResolvedValue({
      orgId: org.orgId,
      userId: org.userId,
      email: "e@example.com",
      role,
      orgName: "Org",
      docName: "Org",
      activeMonth: "2081-01",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    } as Awaited<ReturnType<typeof actionSession>>);
  }

  async function documentedExpense(org: Org, month: string, subtotalCents = 1_000) {
    const [row] = await db
      .insert(expenses)
      .values({
        orgId: org.orgId,
        fundingSourceId: org.sourceId,
        lineItemId: org.itemId,
        month,
        date: `${month}-05`,
        name: "Staples",
        narrative: "Office supplies.",
        paymentSource: "Cash",
        subtotalCents,
        taxReimbursable: false,
        feesReimbursable: true,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(org.orgId, org.sourceId, month),
      })
      .returning({ id: expenses.id });
    const jpeg = await sharp({ create: { width: 60, height: 60, channels: 3, background: { r: 9, g: 9, b: 9 } } })
      .jpeg()
      .toBuffer();
    for (const scope of ["proof", "receipt"] as const) {
      const result = await ingestExpenseDocument({
        orgId: org.orgId,
        expenseId: row.id,
        scope,
        file: new File([new Uint8Array(jpeg)], `${scope}.jpg`, { type: "image/jpeg" }),
      });
      if (!result.ok) throw new Error(result.error);
    }
    return row.id;
  }

  async function pdfFile(): Promise<File> {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).drawText(`signed ${Math.random()}`, { x: 50, y: 700 });
    return new File([new Uint8Array(await doc.save())], "signed.pdf", { type: "application/pdf" });
  }

  function share(org: Org, month: string, kind: "packet" | "summary", password: string | null = null, confirmedDeletions = false) {
    return actions.createSharedLinkAction({ fundingSourceId: org.sourceId, month, kind, password, confirmedDeletions });
  }

  async function rowFor(org: Org, month: string, type: "packet_pdf" | "summary_xlsx") {
    const [row] = await db
      .select()
      .from(sharedLinks)
      .where(and(eq(sharedLinks.orgId, org.orgId), eq(sharedLinks.month, month), eq(sharedLinks.artifactType, type)));
    return row;
  }

  let org: Org;
  let other: Org;

  beforeAll(async () => {
    org = await makeOrg("Share Org");
    other = await makeOrg("Share Other");
  }, 30_000);

  afterAll(async () => {
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
      await rm(path.join(process.cwd(), ".storage", "org", id), { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    clearRateLimit();
    as(org);
  });

  /* ------------------------------------------------------------------ create */

  it("I-1: shares each kind for an admin and a manager, returning a twelve-character link", async () => {
    const month = freshMonth();
    await documentedExpense(org, month);

    const packet = await share(org, month, "packet");
    as(org, "manager");
    const summary = await share(org, month, "summary", "hunter22");

    expect(packet).toEqual({ ok: true, data: { url: expect.stringMatching(/\/s\/[0-9A-Za-z]{12}$/), kind: "packet", hasPassword: false } });
    expect(summary).toEqual({ ok: true, data: { url: expect.stringMatching(/\/s\/[0-9A-Za-z]{12}$/), kind: "summary", hasPassword: true } });

    const row = await rowFor(org, month, "summary_xlsx");
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.filename).toMatch(/_Summary\.xlsx$/);
    expect(row.createdBy).toBe(org.userId);
    expect(row.sharedBy).toBe(org.userId);
  }, 120_000);

  it("I-1: shares a locked month and an archived source", async () => {
    const lockedMonth = freshMonth();
    expect((await lockMonth({ orgId: org.orgId, userId: org.userId, fundingSourceId: org.sourceId, month: lockedMonth as never, file: await pdfFile() })).ok).toBe(true);
    expect((await share(org, lockedMonth, "summary")).ok).toBe(true);

    const [archived] = await db
      .insert(fundingSources)
      .values({ orgId: org.orgId, name: `Archived ${Math.random()}`, type: "grant", sortOrder: 9, archivedAt: new Date(), ...(await import("@/src/modules/expenses/reimbursement")).ORIGINAL_RULES })
      .returning({ id: fundingSources.id });
    const result = await actions.createSharedLinkAction({ fundingSourceId: archived.id, month: freshMonth(), kind: "summary", password: null, confirmedDeletions: false });
    expect(result.ok).toBe(true);
  }, 120_000);

  it("I-2: a second share of the same kind is refused, and the database refuses a second active row", async () => {
    const month = freshMonth();
    expect((await share(org, month, "summary")).ok).toBe(true);
    expect(await share(org, month, "summary")).toEqual({ ok: false, error: UI.shareAlreadyExists });

    const existing = await rowFor(org, month, "summary_xlsx");
    await expect(
      db.insert(sharedLinks).values({ ...existing, id: undefined, token: generateShareToken() } as never),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ constraint: "shared_links_active_uq" }) });
  }, 60_000);

  it("I-3: refuses a blocked month and unconfirmed deletions with the download routes' texts", async () => {
    const blocked = freshMonth();
    await db.insert(expenses).values({
      orgId: org.orgId, fundingSourceId: org.sourceId, lineItemId: org.itemId, month: blocked, date: `${blocked}-05`,
      name: "Blocking expense", narrative: "A narrative.", paymentSource: "Cash", subtotalCents: 1_000,
      taxReimbursable: false, feesReimbursable: true, sortOrder: 0, referenceSeq: await claimReferenceSeq(org.orgId, org.sourceId, blocked),
    });
    expect(await share(org, blocked, "packet")).toEqual({
      ok: false,
      error: "1 record is missing documentation:\n• Blocking expense — A item — missing both",
    });

    const trashedMonth = freshMonth();
    const trashed = await documentedExpense(org, trashedMonth);
    await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, trashed));
    const refused = await share(org, trashedMonth, "summary");
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatch(/^1 expense was deleted from this reporting period/);
    expect((await share(org, trashedMonth, "summary", null, true)).ok).toBe(true);
  }, 60_000);

  it("I-4: sharing reuses a downloaded file — same artifact, nothing written twice — and pins it", async () => {
    const month = freshMonth();
    await documentedExpense(org, month);
    const prepared = await prepareMonthOutput({ orgId: org.orgId, source: { id: org.sourceId, name: "Source 1" }, month: month as never, kind: "summary", confirmedDeletions: false });
    if (!prepared.ok) throw new Error(prepared.message);
    const downloaded = await resolveMonthOutput(prepared);

    const put = vi.spyOn(storage(), "put");
    const result = await share(org, month, "summary");
    const writes = put.mock.calls.length;
    put.mockRestore();

    expect(result.ok).toBe(true);
    expect(writes).toBe(0);
    const row = await rowFor(org, month, "summary_xlsx");
    expect(row.artifactId).toBe(downloaded.artifactId);
  }, 60_000);

  it("I-11: a second build of the same file while one runs is refused", async () => {
    const month = freshMonth();
    const key = shareBuildKey(org.orgId, org.sourceId, month, "summary");
    expect(beginShareBuild(key)).toBe(true);
    try {
      expect(await share(org, month, "summary")).toEqual({ ok: false, error: UI.shareInProgress });
    } finally {
      endShareBuild(key);
    }
    expect((await share(org, month, "summary")).ok).toBe(true);
  }, 60_000);

  it("refuses a malformed request and a short password without touching anything", async () => {
    const month = freshMonth();
    expect(await share(org, month, "summary", "12345")).toEqual({
      ok: false,
      error: UI.sharePasswordTooShort,
      fieldErrors: { password: UI.sharePasswordTooShort },
    });
    expect(await actions.createSharedLinkAction({ fundingSourceId: org.sourceId, month: "2081-13", kind: "summary", password: null, confirmedDeletions: false })).toEqual({ ok: false, error: UI.requestRefused });
    expect(await actions.createSharedLinkAction({ fundingSourceId: org.sourceId, month, kind: "cover" as never, password: null, confirmedDeletions: false })).toEqual({ ok: false, error: UI.requestRefused });
    expect(await rowFor(org, month, "summary_xlsx")).toBeUndefined();
  });

  /* ---------------------------------------------------- records changed + update */

  it("I-5: after an expense edit the row says so; Update keeps the token and moves the file and date", async () => {
    const month = freshMonth();
    const expenseId = await documentedExpense(org, month);
    await share(org, month, "summary", "hunter22");
    const before = await rowFor(org, month, "summary_xlsx");
    await db.update(sharedLinks).set({ sharedAt: new Date("2026-04-08T15:00:00Z") }).where(eq(sharedLinks.id, before.id));

    expect((await loadSharedLinks(org.orgId, org.sourceId, month as never)).links[0].recordsChanged).toBe(false);
    await db.update(expenses).set({ subtotalCents: 1_250 }).where(eq(expenses.id, expenseId));
    expect((await loadSharedLinks(org.orgId, org.sourceId, month as never)).links[0].recordsChanged).toBe(true);

    expect(await actions.updateSharedFileAction({ shareId: before.id, confirmedDeletions: false })).toEqual({ ok: true, data: undefined });

    const after = await rowFor(org, month, "summary_xlsx");
    expect(after.token).toBe(before.token);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.artifactId).not.toBe(before.artifactId);
    expect(after.sharedAt.getTime()).toBeGreaterThan(new Date("2026-04-08T15:00:00Z").getTime());
    expect((await loadSharedLinks(org.orgId, org.sourceId, month as never)).links[0].recordsChanged).toBe(false);

    // The link serves the new file.
    const opened = await loadPublicShare(after.token);
    const [artifact] = await db.select({ s3Key: generatedArtifacts.s3Key }).from(generatedArtifacts).where(eq(generatedArtifacts.id, after.artifactId));
    expect(opened?.s3Key).toBe(artifact.s3Key);
  }, 60_000);

  it("I-6: a month document marks the packet out of date but not the summary, which holds no documents", async () => {
    const prior = freshMonth();
    const month = freshMonth();
    const priorExpense = await documentedExpense(org, prior);
    await documentedExpense(org, month);
    await share(org, month, "packet");
    await share(org, month, "summary");
    const changed = async () =>
      Object.fromEntries(
        (await loadSharedLinks(org.orgId, org.sourceId, month as never)).links.map((link) => [link.kind, link.recordsChanged]),
      );
    expect(await changed()).toEqual({ packet: false, summary: false });

    const upload = await ingestMonthDocument({
      orgId: org.orgId, fundingSourceId: org.sourceId, month, category: "bank_statement",
      file: await pdfFile(),
    });
    expect(upload.ok).toBe(true);
    // The packet prints the bank statement; the workbook's figures are exactly as they were.
    expect(await changed()).toEqual({ packet: true, summary: false });

    const packetRow = await rowFor(org, month, "packet_pdf");
    await actions.updateSharedFileAction({ shareId: packetRow.id, confirmedDeletions: false });
    expect(await changed()).toEqual({ packet: false, summary: false });

    // `freshMonth` only moves forward, so `prior` is an earlier month whose amounts both files
    // print (the summary sheet's previously billed column).
    expect(prior < month).toBe(true);
    await db.update(expenses).set({ subtotalCents: 9_999 }).where(eq(expenses.id, priorExpense));
    expect(await changed()).toEqual({ packet: true, summary: true });
  }, 120_000);

  it("the Update refuses a link stopped before it starts", async () => {
    const month = freshMonth();
    await share(org, month, "summary");
    const row = await rowFor(org, month, "summary_xlsx");
    await actions.stopSharedLinkAction({ shareId: row.id });
    expect(await actions.updateSharedFileAction({ shareId: row.id, confirmedDeletions: false })).toEqual({ ok: false, error: UI.shareNoLongerShared });
  }, 60_000);

  it("a Stop sharing that lands while the Update builds wins, and the link keeps its old file", async () => {
    const month = freshMonth();
    const expenseId = await documentedExpense(org, month);
    await share(org, month, "summary");
    const row = await rowFor(org, month, "summary_xlsx");
    await db.update(expenses).set({ subtotalCents: 4_321 }).where(eq(expenses.id, expenseId));

    // Stop the link at the last moment before the update writes: while the new file is stored.
    const store = storage();
    const original = store.put.bind(store);
    const put = vi.spyOn(store, "put").mockImplementationOnce(async (options) => {
      await actions.stopSharedLinkAction({ shareId: row.id });
      return original(options);
    });
    const result = await actions.updateSharedFileAction({ shareId: row.id, confirmedDeletions: false });
    const puts = put.mock.calls.length;
    put.mockRestore();

    expect(puts).toBe(1);
    expect(result).toEqual({ ok: false, error: UI.shareNoLongerShared });
    const [after] = await db.select().from(sharedLinks).where(eq(sharedLinks.id, row.id));
    expect(after.artifactId).toBe(row.artifactId);
    expect(after.revokedAt).not.toBeNull();
  }, 60_000);

  it("Update applies the download checks: unconfirmed deletions and missing documentation are refused", async () => {
    const month = freshMonth();
    const gone = await documentedExpense(org, month);
    await documentedExpense(org, month);
    await share(org, month, "summary");
    const row = await rowFor(org, month, "summary_xlsx");

    await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, gone));
    const refused = await actions.updateSharedFileAction({ shareId: row.id, confirmedDeletions: false });
    expect(!refused.ok && refused.error).toMatch(/^1 expense was deleted from this reporting period/);
    expect((await rowFor(org, month, "summary_xlsx")).artifactId).toBe(row.artifactId);

    await db.insert(expenses).values({
      orgId: org.orgId, fundingSourceId: org.sourceId, lineItemId: org.itemId, month, date: `${month}-06`,
      name: "Blocking expense", narrative: "A narrative.", paymentSource: "Cash", subtotalCents: 500,
      taxReimbursable: false, feesReimbursable: true, sortOrder: 5, referenceSeq: await claimReferenceSeq(org.orgId, org.sourceId, month),
    });
    expect(await actions.updateSharedFileAction({ shareId: row.id, confirmedDeletions: true })).toEqual({
      ok: false,
      error: "1 record is missing documentation:\n• Blocking expense — A item — missing both",
    });
    expect((await rowFor(org, month, "summary_xlsx")).artifactId).toBe(row.artifactId);
  }, 60_000);

  it("I-11: a second Update of the same file while one builds is refused", async () => {
    const month = freshMonth();
    await share(org, month, "summary");
    const row = await rowFor(org, month, "summary_xlsx");
    const key = shareBuildKey(org.orgId, org.sourceId, month, "summary");
    expect(beginShareBuild(key)).toBe(true);
    try {
      expect(await actions.updateSharedFileAction({ shareId: row.id, confirmedDeletions: false })).toEqual({ ok: false, error: UI.shareInProgress });
    } finally {
      endShareBuild(key);
    }
  }, 60_000);

  /* ----------------------------------------------------------- password + stop */

  it("I-7, I-16: set, replace and remove a password; each change ends the old password and old unlocks", async () => {
    const month = freshMonth();
    await share(org, month, "summary");
    const row = await rowFor(org, month, "summary_xlsx");

    expect(await actions.changeSharedLinkPasswordAction({ shareId: row.id, password: "first-pass" })).toEqual({ ok: true, data: { hasPassword: true } });
    const unlocked = await unlockSharedFile({ token: row.token, password: "first-pass", ip: "203.0.113.1" });
    expect(unlocked.outcome).toBe("open");
    const cookie = unlocked.outcome === "open" ? unlocked.cookie!.value : "";
    expect((await openShare(row.token, cookie)).state).toBe("open");

    expect(await actions.changeSharedLinkPasswordAction({ shareId: row.id, password: "second-pass" })).toEqual({ ok: true, data: { hasPassword: true } });
    expect((await unlockSharedFile({ token: row.token, password: "first-pass", ip: "203.0.113.2" })).outcome).toBe("wrong");
    expect((await openShare(row.token, cookie)).state).toBe("locked");

    expect(await actions.changeSharedLinkPasswordAction({ shareId: row.id, password: null })).toEqual({ ok: true, data: { hasPassword: false } });
    expect((await openShare(row.token, undefined)).state).toBe("open");
  }, 60_000);

  it("I-8: stop sharing ends the link for good; sharing again gives a new one", async () => {
    const month = freshMonth();
    await share(org, month, "summary", "hunter22");
    const first = await rowFor(org, month, "summary_xlsx");

    expect(await actions.stopSharedLinkAction({ shareId: first.id })).toEqual({ ok: true, data: undefined });
    expect(await loadPublicShare(first.token)).toBeNull();
    const [stopped] = await db.select().from(sharedLinks).where(eq(sharedLinks.id, first.id));
    expect(stopped.revokedAt).not.toBeNull();
    expect(stopped.revokedBy).toBe(org.userId);
    expect(stopped.passwordHash).toBeNull();
    expect(await actions.stopSharedLinkAction({ shareId: first.id })).toEqual({ ok: false, error: UI.shareNoLongerShared });

    const again = await share(org, month, "summary");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const token = again.data.url.slice(-12);
    expect(token).not.toBe(first.token);
    expect(await loadPublicShare(token)).not.toBeNull();
    expect(await loadPublicShare(first.token)).toBeNull();
  }, 60_000);

  it("a stopped link leaves the Shared links box, and sharing again shows one row", async () => {
    const month = freshMonth();
    await share(org, month, "summary");
    const row = await rowFor(org, month, "summary_xlsx");
    await actions.stopSharedLinkAction({ shareId: row.id });
    expect((await loadSharedLinks(org.orgId, org.sourceId, month as never)).links).toEqual([]);

    await share(org, month, "summary");
    const view = await loadSharedLinks(org.orgId, org.sourceId, month as never);
    expect(view.links).toHaveLength(1);
    expect(view.links[0].id).not.toBe(row.id);
  }, 60_000);

  it("the database keeps a stopped link from holding a password, or a stopper without a stop", async () => {
    const month = freshMonth();
    await share(org, month, "summary", "hunter22");
    const row = await rowFor(org, month, "summary_xlsx");
    await expect(
      db.update(sharedLinks).set({ revokedAt: new Date() }).where(eq(sharedLinks.id, row.id)),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ constraint: "shared_links_revoked_password_ck" }) });
    await expect(
      db.update(sharedLinks).set({ revokedBy: org.userId }).where(eq(sharedLinks.id, row.id)),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ constraint: "shared_links_revoked_by_ck" }) });
  }, 60_000);

  /* ------------------------------------------------------------ isolation */

  it("I-9: another organization's link is refused by every action and changes nothing", async () => {
    const month = freshMonth();
    await share(org, month, "summary", "hunter22");
    const row = await rowFor(org, month, "summary_xlsx");

    as(other);
    expect(await actions.updateSharedFileAction({ shareId: row.id, confirmedDeletions: false })).toEqual({ ok: false, error: UI.shareNoLongerShared });
    expect(await actions.changeSharedLinkPasswordAction({ shareId: row.id, password: null })).toEqual({ ok: false, error: UI.shareNoLongerShared });
    expect(await actions.stopSharedLinkAction({ shareId: row.id })).toEqual({ ok: false, error: UI.shareNoLongerShared });
    expect(await actions.createSharedLinkAction({ fundingSourceId: org.sourceId, month, kind: "packet", password: null, confirmedDeletions: false })).toEqual({ ok: false, error: "Choose a funding source." });

    const [unchanged] = await db.select().from(sharedLinks).where(eq(sharedLinks.id, row.id));
    expect(unchanged).toEqual(row);
  }, 60_000);

  it("I-10: the database refuses a link to another org's, month's or kind's file", async () => {
    const month = freshMonth();
    await share(org, month, "summary");
    const row = await rowFor(org, month, "summary_xlsx");

    as(other);
    const otherMonth = freshMonth();
    await actions.createSharedLinkAction({ fundingSourceId: other.sourceId, month: otherMonth, kind: "summary", password: null, confirmedDeletions: false });
    const otherRow = await rowFor(other, otherMonth, "summary_xlsx");

    const attempts: Array<Partial<typeof row>> = [
      { artifactId: otherRow.artifactId }, // another org's file
      { month: freshMonth() }, // another month
      { artifactType: "packet_pdf" }, // another kind
    ];
    for (const change of attempts) {
      await expect(db.update(sharedLinks).set(change).where(eq(sharedLinks.id, row.id))).rejects.toMatchObject({
        cause: expect.objectContaining({ constraint: "shared_links_artifact_fk" }),
      });
    }
  }, 60_000);

  it("I-12: the packet tab's view never carries the password hash", async () => {
    const month = freshMonth();
    await share(org, month, "summary", "hunter22");
    const view = await loadSharedLinks(org.orgId, org.sourceId, month as never);
    expect(view.links).toHaveLength(1);
    expect(view.links[0]).toEqual({
      id: expect.any(String),
      kind: "summary",
      url: expect.stringMatching(/\/s\/[0-9A-Za-z]{12}$/),
      hasPassword: true,
      sharedOn: expect.stringMatching(/^\d{1,2}\/\d{1,2}\/\d{4}$/),
      sharedBy: "Misty",
      recordsChanged: false,
    });
    expect(JSON.stringify(view)).not.toMatch(/argon2/);
  }, 60_000);

  /* ------------------------------------------------------------ public lookup */

  it("I-15: five wrong tries lock that visitor out — even for the right password — and no one else", async () => {
    const month = freshMonth();
    await share(org, month, "summary", "right-password");
    const { token } = await rowFor(org, month, "summary_xlsx");
    const ip = "198.51.100.7";

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await unlockSharedFile({ token, password: "wrong-guess", ip })).outcome).toBe("wrong");
    }
    expect((await unlockSharedFile({ token, password: "wrong-guess", ip })).outcome).toBe("too_many");
    expect((await unlockSharedFile({ token, password: "right-password", ip })).outcome).toBe("too_many");
    expect((await unlockSharedFile({ token, password: "right-password", ip: "198.51.100.8" })).outcome).toBe("open");
  }, 60_000);

  it("a right password resets that visitor's count", async () => {
    const month = freshMonth();
    await share(org, month, "summary", "right-password");
    const { token } = await rowFor(org, month, "summary_xlsx");
    const ip = "198.51.100.9";
    for (let i = 0; i < 4; i += 1) await unlockSharedFile({ token, password: "wrong-guess", ip });
    expect((await unlockSharedFile({ token, password: "right-password", ip })).outcome).toBe("open");
    for (let i = 0; i < 4; i += 1) {
      expect((await unlockSharedFile({ token, password: "wrong-guess", ip })).outcome).toBe("wrong");
    }
  }, 60_000);

  it("a guess no password could match costs no try: empty, too short or too long", async () => {
    const month = freshMonth();
    await share(org, month, "summary", "right-password");
    const { token } = await rowFor(org, month, "summary_xlsx");
    const ip = "198.51.100.30";
    for (const guess of ["", "short", "x".repeat(129), 12345678, null]) {
      for (let i = 0; i < 6; i += 1) {
        expect((await unlockSharedFile({ token, password: guess, ip })).outcome).toBe("wrong");
      }
    }
    expect((await unlockSharedFile({ token, password: "right-password", ip })).outcome).toBe("open");
  }, 60_000);

  it("P2: one address is refused across links once its sharePasswordPerIp budget is spent", async () => {
    const { consume, LIMITS } = await import("@/src/services/rate-limit");
    const month = freshMonth();
    await share(org, month, "summary", "right-password");
    const { token } = await rowFor(org, month, "summary_xlsx");
    const ip = "198.51.100.44";
    for (let i = 0; i < LIMITS.sharePasswordPerIp.limit; i += 1) consume("sharePasswordPerIp", ip);
    expect((await unlockSharedFile({ token, password: "right-password", ip })).outcome).toBe("too_many");
    expect((await unlockSharedFile({ token, password: "right-password", ip: "198.51.100.45" })).outcome).toBe("open");
  }, 60_000);

  it("an IPv6 visitor's guesses count against their whole /64", async () => {
    const month = freshMonth();
    await share(org, month, "summary", "right-password");
    const { token } = await rowFor(org, month, "summary_xlsx");
    for (let i = 1; i <= 5; i += 1) await unlockSharedFile({ token, password: "wrong-guess", ip: `2001:db8:1:2::${i}` });
    expect((await unlockSharedFile({ token, password: "right-password", ip: "2001:db8:1:2::99" })).outcome).toBe("too_many");
    expect((await unlockSharedFile({ token, password: "right-password", ip: "2001:db8:1:3::1" })).outcome).toBe("open");
  }, 60_000);

  it("I-18: a paused or cancelled organization's links are unavailable, and work again once restored", async () => {
    const month = freshMonth();
    await share(org, month, "summary");
    const { token } = await rowFor(org, month, "summary_xlsx");
    expect(await loadPublicShare(token)).not.toBeNull();

    await db.update(organizations).set({ suspendedAt: new Date() }).where(eq(organizations.id, org.orgId));
    expect(await loadPublicShare(token)).toBeNull();
    await db.update(organizations).set({ suspendedAt: null }).where(eq(organizations.id, org.orgId));
    expect(await loadPublicShare(token)).not.toBeNull();

    await db.update(organizations).set({ subscriptionStatus: "cancelled" }).where(eq(organizations.id, org.orgId));
    expect(await loadPublicShare(token)).toBeNull();
    expect((await loadSharedLinks(org.orgId, org.sourceId, month as never)).orgCancelled).toBe(true);
    await db.update(organizations).set({ subscriptionStatus: "active" }).where(eq(organizations.id, org.orgId));
    expect(await loadPublicShare(token)).not.toBeNull();
  }, 60_000);

  it("unknown and malformed tokens find nothing", async () => {
    expect(await loadPublicShare("AAAAAAAAAAAA")).toBeNull();
    expect(await loadPublicShare("../../etc/pw")).toBeNull();
    expect((await unlockSharedFile({ token: "AAAAAAAAAAAA", password: "x", ip: "203.0.113.5" })).outcome).toBe("unavailable");
  });

  it("create and update refuse once the organization's generation budget is spent", async () => {
    const { consume, LIMITS } = await import("@/src/services/rate-limit");
    const month = freshMonth();
    await share(org, month, "summary");
    const row = await rowFor(org, month, "summary_xlsx");
    for (let i = 0; i < LIMITS.generate.limit; i += 1) consume("generate", org.orgId);

    const budget = expect.stringMatching(/^Too many documents requested at once\. Try again in \d+ seconds?\.$/);
    expect(await share(org, freshMonth(), "summary")).toEqual({ ok: false, error: budget });
    expect(await actions.updateSharedFileAction({ shareId: row.id, confirmedDeletions: false })).toEqual({ ok: false, error: budget });
  }, 60_000);

  it("Change password is refused once the user's sharePasswordSet budget is spent", async () => {
    const { consume, LIMITS } = await import("@/src/services/rate-limit");
    const month = freshMonth();
    await share(org, month, "summary");
    const row = await rowFor(org, month, "summary_xlsx");
    for (let i = 0; i < LIMITS.sharePasswordSet.limit; i += 1) consume("sharePasswordSet", org.userId);
    expect(await actions.changeSharedLinkPasswordAction({ shareId: row.id, password: "another-pass" })).toEqual({
      ok: false,
      error: expect.stringMatching(/^Too many password changes\. Try again in \d+ minutes?\.$/),
    });
    expect((await rowFor(org, month, "summary_xlsx")).passwordHash).toBeNull();
  }, 60_000);

  it("C4: a cancelled organization can't share or update — its links wouldn't open", async () => {
    const month = freshMonth();
    await share(org, month, "summary");
    const row = await rowFor(org, month, "summary_xlsx");
    await db.update(organizations).set({ subscriptionStatus: "cancelled" }).where(eq(organizations.id, org.orgId));
    try {
      expect(await share(org, month, "packet")).toEqual({ ok: false, error: UI.shareCancelledRefused });
      expect(await actions.updateSharedFileAction({ shareId: row.id, confirmedDeletions: false })).toEqual({
        ok: false,
        error: UI.shareCancelledRefused,
      });
      expect(await rowFor(org, month, "packet_pdf")).toBeUndefined();
    } finally {
      await db.update(organizations).set({ subscriptionStatus: "active" }).where(eq(organizations.id, org.orgId));
    }
  }, 60_000);

  it("the box lists the packet first, and a sharer whose account is gone reads Unknown", async () => {
    const month = freshMonth();
    await documentedExpense(org, month);
    await share(org, month, "summary");
    await share(org, month, "packet");
    expect((await loadSharedLinks(org.orgId, org.sourceId, month as never)).links.map((link) => link.kind)).toEqual([
      "packet",
      "summary",
    ]);

    const [temp] = await db
      .insert(users)
      .values({ orgId: org.orgId, email: `gone-${Date.now()}@example.test`, passwordHash: await hashPassword("original-password-here"), role: "manager" })
      .returning({ id: users.id });
    await db.update(sharedLinks).set({ sharedBy: temp.id }).where(and(eq(sharedLinks.orgId, org.orgId), eq(sharedLinks.month, month), eq(sharedLinks.artifactType, "packet_pdf")));
    await db.delete(users).where(eq(users.id, temp.id));
    const [packet] = (await loadSharedLinks(org.orgId, org.sourceId, month as never)).links;
    expect(packet.sharedBy).toBe("Unknown");
  }, 120_000);

  it("I-22: deleting an organization that has shared links succeeds", async () => {
    const doomed = await makeOrg("Share Doomed");
    as(doomed);
    expect((await share(doomed, freshMonth(), "summary")).ok).toBe(true);
    await db.delete(organizations).where(eq(organizations.id, doomed.orgId));
    const left = await db.select().from(sharedLinks).where(eq(sharedLinks.orgId, doomed.orgId));
    expect(left).toHaveLength(0);
  }, 60_000);
});
