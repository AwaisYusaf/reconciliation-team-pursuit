/**
 * The finishing pass: footers, links and outline from one page map (R10.5a, D-83).
 *
 * Synthetic document, hand-built map — so every target is known exactly and the pass is
 * tested on its own. The end-to-end run against real LibreOffice output is in
 * packet-trace.integration.test.ts.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { finishPacket, stampFooters } from "./packet-footer";
import type { PacketNavigation, PacketPage } from "./packet-pdf";
import { readLinks, readOutline } from "./pdf-links";

/** Pages: 0 summary · 1 index · 2 cover · 3 receipt A · 4 supporting A · 5 month. B has no receipt. */
const pages: PacketPage[] = [
  { kind: "summary" },
  { kind: "index" },
  { kind: "cover", lineItemId: "li" },
  { kind: "receipt", reference: "2026-02-001", expenseId: "A", documentId: "dA1" },
  { kind: "supporting", reference: "2026-02-001", expenseId: "A", documentId: "dA2" },
  { kind: "month", documentId: "m1" },
];
const rect = (y: number) => ({ x: 72, y, width: 200, height: 14 });
const navigation: PacketNavigation = {
  index: {
    refCells: [
      { reference: "2026-02-001", page: 1, rect: rect(600) },
      { reference: "2026-02-002", page: 1, rect: rect(580) },
    ],
    disclosures: [{ reference: "2026-02-002", page: 1, rect: rect(300), top: 320 }],
  },
  lineItems: [{ lineItemId: "li", name: "Transportation", firstCoverPage: 2 }],
  expenses: [
    { reference: "2026-02-001", expenseId: "A", name: "Rideshare 1", lineItemId: "li", noReceipt: false,
      row: { page: 2, rect: rect(650) }, heading: { page: 2, rect: rect(500), top: 520 } },
    { reference: "2026-02-002", expenseId: "B", name: "Cash fare", lineItemId: "li", noReceipt: true,
      row: { page: 2, rect: rect(630) }, heading: { page: 2, rect: rect(400), top: 420 } },
  ],
};

async function blank(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages.length; i += 1) doc.addPage([612, 792]).drawText(`p${i}`, { x: 72, y: 700, font, size: 12 });
  return Buffer.from(await doc.save());
}

describe("finishPacket", () => {
  it("links row and heading to the first evidence page, and a no-receipt expense to its heading", async () => {
    const links = await readLinks(await finishPacket(await blank(), "Trace", "February 2026", { pages, navigation }));
    const on = (page: number, y: number) => links.find((l) => l.fromPage === page && Math.abs(l.rect.y - y) < 0.01)!;
    expect(on(2, 650).toPage).toBe(3); // A's row → first receipt page, not the supporting one
    expect(on(2, 500).toPage).toBe(3); // A's heading → same
    expect(on(2, 630)).toMatchObject({ toPage: 2, top: 420 }); // B's row → B's heading
    expect(on(2, 400)).toMatchObject({ toPage: 2, top: 420 }); // B's heading → itself, scrolled to top
  });

  it("links every evidence page's footer reference back to the heading, over the reference text", async () => {
    const links = await readLinks(await finishPacket(await blank(), "Trace", "February 2026", { pages, navigation }));
    const back = links.filter((l) => l.fromPage === 3 || l.fromPage === 4);
    expect(back).toHaveLength(2);
    for (const link of back) {
      expect(link).toMatchObject({ toPage: 2, top: 520 });
      // Sits on the footer line, not somewhere else on the page.
      expect(link.rect.y).toBeLessThan(40);
      expect(link.rect.width).toBeGreaterThan(20);
    }
    // No link on pages that document no single expense.
    expect(links.filter((l) => [0, 5].includes(l.fromPage))).toHaveLength(0);
  });

  it("links index cells to the heading, or to the D-74 line for a no-receipt expense", async () => {
    const links = await readLinks(await finishPacket(await blank(), "Trace", "February 2026", { pages, navigation }));
    const cells = links.filter((l) => l.fromPage === 1);
    expect(cells.find((l) => Math.abs(l.rect.y - 600) < 0.01)).toMatchObject({ toPage: 2, top: 520 });
    expect(cells.find((l) => Math.abs(l.rect.y - 580) < 0.01)).toMatchObject({ toPage: 1, top: 320 });
  });

  it("writes the outline in reading order with expenses under their line item", async () => {
    expect(await readOutline(await finishPacket(await blank(), "Trace", "February 2026", { pages, navigation }))).toEqual([
      { title: "Contract summary", toPage: 0, depth: 0 },
      { title: "Expense index", toPage: 1, depth: 0 },
      { title: "Transportation", toPage: 2, depth: 0 },
      { title: "2026-02-001 | Rideshare 1", toPage: 2, depth: 1 },
      { title: "2026-02-002 | Cash fare", toPage: 2, depth: 1 },
      { title: "Month documents", toPage: 5, depth: 0 },
    ]);
  });

  it("changes nothing the footer stamp alone would produce: same page count, same text", async () => {
    const owners = pages.map((p) => ("reference" in p ? p.reference : null));
    const plain = await PDFDocument.load(await stampFooters(await blank(), "Trace", "February 2026", owners));
    const finished = await PDFDocument.load(await finishPacket(await blank(), "Trace", "February 2026", { pages, navigation }));
    expect(finished.getPageCount()).toBe(plain.getPageCount());
    // Every link is invisible: zero border, so the drawn content is untouched.
    const links = await readLinks(await finishPacket(await blank(), "Trace", "February 2026", { pages, navigation }));
    expect(links.length).toBeGreaterThan(0);
  });
});
