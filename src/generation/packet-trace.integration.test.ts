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

import type { PacketPage } from "./packet-pdf";
import { toPdfRect, wordsOf } from "./pdf-anchors";
import { readLinks, readOutline } from "./pdf-links";

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
  const { createTestOrg } = await import("@/src/db/test-org");
  const { ingestExpenseDocument, ingestMonthDocument } = await import(
    "@/src/services/storage/documents"
  );
  const { loadMonthSnapshot } = await import("./month-snapshot");
  const { buildDeliverablePacket } = await import("./packet-build");
  const { buildPacketPdf } = await import("./packet-pdf");

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let delivered: Buffer;
  let assembled: Awaited<ReturnType<typeof buildPacketPdf>>;
  let pageText: string[];
  let pageCount: number;

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Trace Org", docName: "Trace", activeMonth: MONTH });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    await db.insert(contractSettings).values({ orgId, projectName: "CVI" });
    await db
      .insert(paymentSources)
      .values({ orgId, label: "Paid by us, reimbursement requested", sortOrder: 0 });
    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Transportation", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

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
          fundingSourceId,
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

    // A fourth expense with no receipt (R4.4): a proof only. It has no evidence page, so its
    // links must go to its own heading and the index must send readers to its D-74 line.
    const [cash] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId,
        lineItemId: item.id,
        month: MONTH,
        date: `${MONTH}-14`,
        name: "Cash fare",
        description: "Outreach travel",
        paymentSource: "Paid by us, reimbursement requested",
        subtotalCents: 1_500,
        sortOrder: 4,
        referenceSeq: 4,
        taxReimbursable: false,
        feesReimbursable: true,
        noReceipt: true,
        noReceiptReason: "Paid in cash, receipt lost",
      })
      .returning({ id: expenses.id });
    const cashProof = await ingestExpenseDocument({
      orgId,
      expenseId: cash.id,
      scope: "proof",
      file: new File([new Uint8Array(jpeg)], "proof-4.jpg", { type: "image/jpeg" }),
    });
    if (!cashProof.ok) throw new Error(cashProof.error);

    // One month-level document, so the packet has a section that belongs to no expense. The
    // fixture had none, which is why nothing caught a bank statement sitting at the front.
    const monthDoc = await ingestMonthDocument({
      orgId,
      fundingSourceId,
      month: MONTH,
      category: "bank_statement",
      title: "February statement",
      file: new File([new Uint8Array(jpeg)], "statement.jpg", { type: "image/jpeg" }),
    });
    if (!monthDoc.ok) throw new Error(monthDoc.error);

    const snapshot = await loadMonthSnapshot(orgId, fundingSourceId, MONTH);
    const packet = await buildDeliverablePacket(snapshot);
    pageCount = packet.pageCount;
    delivered = packet.pdf;
    // The same snapshot assembled again exposes the page map the delivered bytes were built
    // from; generation is deterministic (R10.1), which the map test below holds it to.
    assembled = await buildPacketPdf(snapshot);

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
      .map((text, index) => (text.includes(`| ${reference} | Page`) ? index + 1 : 0))
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
    const referenceOnPage = /\| \d{4}-\d{2}-\d{3} \| Page/;
    // TEMPORARILY HIDDEN (D-114): pages 1 and 2 were the summary and the index. While they are
    // hidden, page 2 can be a receipt, so every non-evidence page is checked from the page map.
    // expect(referenceOnPage.test(pageText[0])).toBe(false);
    // expect(referenceOnPage.test(pageText[1])).toBe(false);
    assembled.pages.forEach((page, index) => {
      if (page.kind !== "receipt" && page.kind !== "supporting") {
        expect(referenceOnPage.test(pageText[index])).toBe(false);
      }
    });
  });

  it("still numbers every page against the final total (R10.5)", () => {
    for (const [index, text] of pageText.entries()) {
      expect(text).toContain(`Page ${index + 1} of ${pageCount}`);
    }
  });

  it("keeps the organisation and month on every page", () => {
    for (const text of pageText) expect(text).toContain("Trace | February 2099");
  });

  it("puts the month documents after every expense's evidence (D-77)", () => {
    // The client's complaint: a bank statement before the first cover letter. A month document
    // carries no expense reference (D-70) and every receipt page does, so the position is
    // readable from the footers alone.
    const referenced = pageText
      .map((text, index) => (/\| \d{4}-\d{2}-\d{3} \| Page/.test(text) ? index + 1 : 0))
      .filter(Boolean);

    expect(referenced.length).toBeGreaterThan(0);
    // The single month document is the last page, so the last referenced page is the one before.
    expect(Math.max(...referenced)).toBe(pageCount - 1);
    expect(/\| \d{4}-\d{2}-\d{3} \| Page/.test(pageText[pageCount - 1])).toBe(false);
  });

  // TEMPORARILY HIDDEN (D-114): the summary and index are left out, so the packet opens on the
  // first cover sheet. When they are uncommented, restore this test and drop the one below it.
  // it("still opens on the summary and the index", () => {
  //   // Moving one section must not disturb the two that introduce the packet.
  //   expect(pageText[0]).toContain("Contract Summary");
  //   expect(pageText[1]).toMatch(/Ref|Expense/);
  // });
  it("opens on the first cover sheet while the summary and index are hidden (D-114)", () => {
    expect(pageText[0]).toContain("Transportation Breakdown");
    expect(pageText.some((text) => text.includes("Contract Summary"))).toBe(false);
    expect(pageText.some((text) => text.includes("Expense Index"))).toBe(false);
  });

  it("records what every page is, in order, from a real assembly (D-83)", async () => {
    // The map the footers and the links are both drawn from. Asserted for every page rather
    // than sampled: a page recorded wrongly is a footer that lies and a link that lands on the
    // wrong evidence, and neither announces itself.
    const { pages, pageOwners } = assembled;
    expect(pages).toHaveLength(pageCount);
    expect(assembled.pageCount).toBe(pageCount);

    const kinds = pages.map((page) => page.kind);
    // Summary and index may each run to more than one page, but nothing else precedes them.
    // TEMPORARILY HIDDEN (D-114): restore these three when the summary and index come back.
    // expect(kinds[0]).toBe("summary");
    // expect(kinds.indexOf("index")).toBe(kinds.lastIndexOf("summary") + 1);
    // expect(kinds.indexOf("cover")).toBe(kinds.lastIndexOf("index") + 1);
    expect(kinds[0]).toBe("cover");
    expect(kinds).not.toContain("summary");
    expect(kinds).not.toContain("index");
    for (const page of pages) if (page.kind === "cover") expect(page.lineItemId).toBe(lineItemId);

    // Three expenses, each with one single-page receipt; proofs live inside the cover sheet and
    // contribute no pages of their own (R11.3).
    const receipts = pages.filter(
      (page): page is Extract<PacketPage, { kind: "receipt" }> => page.kind === "receipt",
    );
    expect(receipts.map((page) => page.reference)).toEqual([
      `${MONTH}-001`, `${MONTH}-002`, `${MONTH}-003`,
    ]);
    expect(new Set(receipts.map((page) => page.expenseId)).size).toBe(3);
    expect(new Set(receipts.map((page) => page.documentId)).size).toBe(3);
    expect(kinds.filter((kind) => kind === "supporting")).toHaveLength(0);

    // The single month document is the last page (D-77), and nothing follows it.
    expect(kinds.at(-1)).toBe("month");
    expect(kinds.filter((kind) => kind === "month")).toHaveLength(1);

    // `pageOwners` is derived from the map, so the footer cannot disagree with the links.
    expect(pageOwners).toEqual(pages.map((page) => ("reference" in page ? page.reference : null)));
  });

  describe("navigation on the delivered bytes (R10.5a, D-83)", () => {
    // 0-based page index of the first page carrying a reference's footer.
    const firstEvidence = (reference: string) => pagesCarrying(reference)[0] - 1;
    // A cover sheet runs to several pages when each proof image fills one; only its first page
    // carries the title, so cover pages are read from the page map, not from their text.
    const isCover = (page: number) => assembled.pages[page]?.kind === "cover";

    it("resolves every link to a page in this document", async () => {
      const links = await readLinks(delivered);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link.toPage).toBeGreaterThanOrEqual(0);
    });

    it("sends each documented expense's row and heading to its first receipt page", async () => {
      const links = await readLinks(delivered);
      for (const seq of [1, 2, 3]) {
        const target = firstEvidence(`${MONTH}-00${seq}`);
        // Two links from a cover page land on this expense's evidence: the row and the heading.
        const inbound = links.filter((l) => l.toPage === target && isCover(l.fromPage));
        expect(inbound).toHaveLength(2);
      }
    });

    it("sends each evidence page's footer back to the heading, over the reference text", async () => {
      const links = await readLinks(delivered);
      const words = wordsOf(delivered);
      for (const seq of [1, 2, 3]) {
        const reference = `${MONTH}-00${seq}`;
        for (const page of pagesCarrying(reference).map((n) => n - 1)) {
          const back = links.filter((l) => l.fromPage === page);
          expect(back).toHaveLength(1);
          expect(isCover(back[0].toPage)).toBe(true);
          expect(back[0].top).not.toBeNull();
          // The clickable box sits on the footer's own reference token.
          const token = words.find((w) => w.page === page && w.text === reference)!;
          const box = toPdfRect(token, token.pageHeight);
          expect(back[0].rect.x).toBeLessThanOrEqual(box.x + 0.5);
          expect(back[0].rect.x + back[0].rect.width).toBeGreaterThanOrEqual(box.x + box.width - 0.5);
        }
      }
    });

    it("puts each heading link over the heading's reference token", async () => {
      const links = await readLinks(delivered);
      const words = wordsOf(delivered);
      for (const seq of [1, 2, 3, 4]) {
        // On the cover sheet: the index's no-receipt line prints the same `(reference):` form.
        const token = words.find((w) => w.text === `(${MONTH}-00${seq}):` && isCover(w.page))!;
        expect(token).toBeDefined();
        const box = toPdfRect(token, token.pageHeight);
        const over = links.filter(
          (l) => l.fromPage === token.page && l.rect.x <= box.x + 0.5 && l.rect.y <= box.y + 0.5 &&
            l.rect.x + l.rect.width >= box.x + box.width - 0.5 && l.rect.y + l.rect.height >= box.y + box.height - 0.5,
        );
        expect(over.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("sends the no-receipt expense to its heading, and its index row to the D-74 line", async () => {
      const links = await readLinks(delivered);
      const words = wordsOf(delivered);
      const heading = words.find((w) => w.text === `(${MONTH}-004):` && isCover(w.page))!;
      const toHeading = links.filter((l) => l.toPage === heading.page && l.top !== null && isCover(l.fromPage));
      // Row and heading both land on the heading, scrolled to the top.
      expect(toHeading.length).toBeGreaterThanOrEqual(2);
      // TEMPORARILY HIDDEN (D-114): no index, so no index links and no D-74 line. Restore these
      // when the index comes back.
      // const indexPages = pageText.map((t, i) => (t.includes("Expense Index") ? i : -1)).filter((i) => i >= 0);
      // const fromIndex = links.filter((l) => indexPages.includes(l.fromPage));
      // // Four Ref cells; the no-receipt one stays inside the index, pointing at its disclosure.
      // expect(fromIndex).toHaveLength(4);
      // expect(fromIndex.filter((l) => indexPages.includes(l.toPage) && l.top !== null)).toHaveLength(1);
      // expect(pageText.some((t) => t.includes("no receipt available") && t.includes("Paid in cash"))).toBe(true);
      // The trail still explains itself where it ends: the cover sheet prints the reason (R6.7).
      expect(
        pageText.some((t, i) => isCover(i) && /No\s+receipt\s+available/.test(t) && /Paid\s+in\s+cash/.test(t)),
      ).toBe(true);
    });

    it("lists the packet in the outline, expenses under their line item", async () => {
      const outline = await readOutline(delivered);
      expect(outline.map((o) => o.title)).toEqual([
        // "Contract summary", // TEMPORARILY HIDDEN (D-114)
        // "Expense index", // TEMPORARILY HIDDEN (D-114)
        "Transportation",
        `${MONTH}-001 | Rideshare 1`,
        `${MONTH}-002 | Rideshare 2`,
        `${MONTH}-003 | Rideshare 3`,
        `${MONTH}-004 | Cash fare`,
        "Month documents",
      ]);
      expect(outline.filter((o) => o.depth === 1)).toHaveLength(4);
      for (const item of outline) expect(item.toPage).toBeGreaterThanOrEqual(0);
    });
  });
});
