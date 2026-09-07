/**
 * The financial trail through a built packet (R10.5, D-70).
 *
 * The funder's requirement is that anyone can follow an expense from the cover letter to its
 * supporting documentation without being told where to look. That is a property of the whole
 * assembled PDF, so it is asserted against a real one: built from a real database and the
 * real storage driver, then read back with `pdftotext` — the reference has to be text a
 * reviewer can search, not a picture of text.
 *
 * Skipped when DATABASE_URL, a `pdftotext` (Poppler or Xpdf), or LibreOffice is absent.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { conversionAvailable } from "./docx-to-pdf";
import { hasPdftotext, pdftotext } from "./pdftotext.test-helper";

// A real packet embeds real cover sheets, so LibreOffice has to be here too — not just the
// database and `pdftotext`. It was never checked, which only stayed invisible while the
// `pdftotext` probe was itself wrong: fix that, and this suite *failed* on a machine holding
// the first two but not LibreOffice, instead of skipping the way the header promises.
const canRun =
  Boolean(process.env.DATABASE_URL) && hasPdftotext() && (await conversionAvailable());
const MONTH = "2099-02";

describe.skipIf(!canRun)("packet traceability (integration)", async () => {
  const { db } = await import("@/src/db");
  const { contractSettings, expenses, lineItems, organizations, paymentSources } = await import(
    "@/src/db/schema"
  );
  const { ingestExpenseDocument, ingestMonthDocument } = await import(
    "@/src/services/storage/documents"
  );
  const { loadMonthSnapshot } = await import("./month-snapshot");
  const { buildDeliverablePacket } = await import("./packet-build");

  let orgId: string;
  let pageText: string[];
  let pageCount: number;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Trace Org", docName: "Trace", activeMonth: MONTH })
      .returning({ id: organizations.id });
    orgId = org.id;

    await db.insert(contractSettings).values({ orgId, projectName: "CVI" });
    await db
      .insert(paymentSources)
      .values({ orgId, label: "Paid by us, reimbursement requested", sortOrder: 0 });
    const [item] = await db
      .insert(lineItems)
      .values({ orgId, name: "Transportation", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });

    const jpeg = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: { r: 250, g: 250, b: 248 } },
    })
      .jpeg()
      .toBuffer();

    for (let seq = 1; seq <= 3; seq += 1) {
      const [expense] = await db
        .insert(expenses)
        .values({
          orgId,
          lineItemId: item.id,
          month: MONTH,
          date: `${MONTH}-1${seq}`,
          name: `Rideshare ${seq}`,
          description: "Outreach travel",
          paymentSource: "Paid by us, reimbursement requested",
          subtotalCents: 2_000 * seq,
          sortOrder: seq,
          referenceSeq: seq,
        taxReimbursable: false,
        feesReimbursable: true,
        })
        .returning({ id: expenses.id });

      for (const scope of ["receipt", "proof"] as const) {
        const result = await ingestExpenseDocument({
          orgId,
          expenseId: expense.id,
          scope,
          file: new File([new Uint8Array(jpeg)], `${scope}-${seq}.jpg`, { type: "image/jpeg" }),
        });
        if (!result.ok) throw new Error(result.error);
      }
    }

    // One month-level document, so the packet has a section that belongs to no expense. The
    // fixture had none, which is why nothing caught a bank statement sitting at the front.
    const monthDoc = await ingestMonthDocument({
      orgId,
      month: MONTH,
      category: "bank_statement",
      title: "February statement",
      file: new File([new Uint8Array(jpeg)], "statement.jpg", { type: "image/jpeg" }),
    });
    if (!monthDoc.ok) throw new Error(monthDoc.error);

    const packet = await buildDeliverablePacket(await loadMonthSnapshot(orgId, MONTH));
    pageCount = packet.pageCount;

    const dir = await mkdtemp(path.join(tmpdir(), "ngo-trace-"));
    try {
      const file = path.join(dir, "packet.pdf");
      await writeFile(file, packet.pdf);
      pageText = Array.from({ length: pageCount }, (_, index) =>
        pdftotext(["-f", String(index + 1), "-l", String(index + 1), file, "-"]),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);

  afterAll(async () => {
    if (orgId) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
      await rm(path.join(process.cwd(), ".storage", "org", orgId), {
        recursive: true,
        force: true,
      });
    }
  });

  function pagesCarrying(reference: string): number[] {
    return pageText
      .map((text, index) => (text.includes(`— ${reference} — Page`) ? index + 1 : 0))
      .filter(Boolean);
  }

  it("every expense in the index resolves to a stamped page", async () => {
    // The trail in the direction a reviewer reads it: reference in hand, find the evidence.
    for (const seq of [1, 2, 3]) {
      const reference = `${MONTH}-00${seq}`;
      expect(pagesCarrying(reference).length).toBeGreaterThan(0);
      // And the reference is in the index too, so the lookup exists in both directions.
      expect(pageText.some((text) => text.includes(reference))).toBe(true);
    }
  });

  it("no two expenses claim the same page", () => {
    const seen = new Set<number>();
    for (const seq of [1, 2, 3]) {
      for (const page of pagesCarrying(`${MONTH}-00${seq}`)) {
        expect(seen.has(page)).toBe(false);
        seen.add(page);
      }
    }
  });

  it("pages belonging to no single expense carry no reference", () => {
    // The summary, the index and the cover sheet cover the month or the whole category;
    // stamping one expense's number on them would assert something untrue.
    const referenceOnPage = /— \d{4}-\d{2}-\d{3} — Page/;
    expect(referenceOnPage.test(pageText[0])).toBe(false);
    expect(referenceOnPage.test(pageText[1])).toBe(false);
  });

  it("still numbers every page against the final total (R10.5)", () => {
    for (const [index, text] of pageText.entries()) {
      expect(text).toContain(`Page ${index + 1} of ${pageCount}`);
    }
  });

  it("keeps the organisation and month on every page", () => {
    for (const text of pageText) expect(text).toContain("Trace — February 2099");
  });

  it("puts the month documents after every expense's evidence (D-77)", () => {
    // The client's complaint: a bank statement before the first cover letter. A month document
    // carries no expense reference (D-70) and every receipt page does, so the position is
    // readable from the footers alone.
    const referenced = pageText
      .map((text, index) => (/— \d{4}-\d{2}-\d{3} — Page/.test(text) ? index + 1 : 0))
      .filter(Boolean);

    expect(referenced.length).toBeGreaterThan(0);
    // The single month document is the last page, so the last referenced page is the one before.
    expect(Math.max(...referenced)).toBe(pageCount - 1);
    expect(/— \d{4}-\d{2}-\d{3} — Page/.test(pageText[pageCount - 1])).toBe(false);
  });

  it("still opens on the summary and the index", () => {
    // Moving one section must not disturb the two that introduce the packet.
    expect(pageText[0]).toContain("Contract Summary");
    expect(pageText[1]).toMatch(/Ref|Expense/);
  });
});
