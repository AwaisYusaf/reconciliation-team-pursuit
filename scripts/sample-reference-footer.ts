/**
 * Generates the sample page attached to `docs/02-outputs/reference-footer-proposal.md`.
 *
 *   npx tsx --conditions=react-server scripts/sample-reference-footer.ts out.pdf
 *
 * Two pages of the same receipt: the footer as it is today, and as proposed. It goes through
 * the real rasteriser at the real DPI and is placed by the same arithmetic as the packet, so
 * what the funder sees is what they would actually receive — not a mockup of it.
 *
 * The receipt is synthetic. Nothing from `context/manual packet/` may be reproduced here: it
 * holds real participant data and this document is intended to leave the organisation.
 */
import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFPage } from "pdf-lib";
import { inchesToPoints } from "@/src/generation/layout-constants";
import { rasterizePdf, DEFAULT_QUALITY } from "@/src/generation/raster";

const OUT = process.argv[2];
const PAGE_W = inchesToPoints(8.5);
const PAGE_H = inchesToPoints(11);
const MARGIN = inchesToPoints(0.5);
const FOOTER_SIZE = 9;
const FOOTER_GREY = rgb(0.47, 0.47, 0.47);
const FOOTER_FROM_BOTTOM = inchesToPoints(0.35);
const INK = rgb(0.15, 0.15, 0.15);
const RULE = rgb(0.8, 0.8, 0.8);

async function receiptPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([396, 612]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 0, y: 0, width: 396, height: 612, color: rgb(0.98, 0.98, 0.97) });

  let y = 560;
  function line(text: string, size: number, f: typeof font, gap: number): void {
    page.drawText(text, { x: 34, y, size, font: f, color: INK });
    y -= gap;
  }
  function rule(): void {
    page.drawLine({ start: { x: 34, y }, end: { x: 362, y }, color: RULE });
    y -= 26;
  }
  function row(label: string, value: string, f: typeof font): void {
    page.drawText(label, { x: 34, y, size: 10, font: f, color: INK });
    const w = f.widthOfTextAtSize(value, 10);
    page.drawText(value, { x: 362 - w, y, size: 10, font: f, color: INK });
    y -= 22;
  }

  line("RIDESHARE CO.", 15, bold, 30);
  line("Trip receipt", 10, font, 28);
  line("Thursday, 12 February 2026", 10, font, 16);
  line("6:41 PM", 10, font, 30);
  rule();
  line("Pickup    E Warren Ave & Van Dyke", 9.5, font, 18);
  line("Dropoff   Community Center, Detroit", 9.5, font, 30);
  rule();
  row("Trip fare", "$18.40", font);
  row("Booking fee", "$2.15", font);
  row("Sales tax", "$1.24", font);
  page.drawLine({ start: { x: 34, y: y + 12 }, end: { x: 362, y: y + 12 }, color: RULE });
  y -= 6;
  row("Total charged", "$21.79", bold);
  y -= 14;
  line("Visa ending 4412", 9.5, font, 18);
  line("Receipt #RC-8841-2026", 9.5, font, 18);

  return Buffer.from(await pdf.save());
}

async function placed(pdf: PDFDocument, jpeg: Buffer, wPx: number, hPx: number): Promise<PDFPage> {
  const image = await pdf.embedJpg(jpeg);
  const toPt = (px: number): number => (px / DEFAULT_QUALITY.dpi) * 72;
  const scale = Math.min((PAGE_W - MARGIN * 2) / toPt(wPx), (PAGE_H - MARGIN * 2) / toPt(hPx), 1);
  const w = toPt(wPx) * scale;
  const h = toPt(hPx) * scale;
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  page.drawImage(image, { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, width: w, height: h });
  return page;
}

async function main(): Promise<void> {
  const receipt = await receiptPdf();
  const shots: Array<{ jpeg: Buffer; w: number; h: number }> = [];
  await rasterizePdf(
    receipt,
    async (p) => {
      shots.push({ jpeg: p.jpeg, w: p.widthPx, h: p.heightPx });
    },
    DEFAULT_QUALITY,
    1,
  );

  const out = await PDFDocument.create();
  out.setTitle("Expense reference in the packet footer - sample");
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);

  function caption(page: PDFPage, text: string): void {
    page.drawRectangle({ x: 0, y: PAGE_H - 42, width: PAGE_W, height: 42, color: rgb(0.945, 0.925, 0.886) });
    page.drawText(text, { x: MARGIN, y: PAGE_H - 27, size: 11, font: bold, color: rgb(0.36, 0.23, 0.16) });
  }
  function footer(page: PDFPage, text: string): void {
    const w = font.widthOfTextAtSize(text, FOOTER_SIZE);
    page.drawText(text, { x: (PAGE_W - w) / 2, y: FOOTER_FROM_BOTTOM, size: FOOTER_SIZE, font, color: FOOTER_GREY });
  }

  const a = await placed(out, shots[0].jpeg, shots[0].w, shots[0].h);
  caption(a, "TODAY  -  the footer every packet page already carries");
  footer(a, "Team Pursuit Global | February 2026 | Page 84 of 132");

  const b = await placed(out, shots[0].jpeg, shots[0].w, shots[0].h);
  caption(b, "PROPOSED  -  the same footer, with the expense reference added");
  footer(b, "Team Pursuit Global | February 2026 | 2026-02-014 | Page 84 of 132");

  writeFileSync(OUT, await out.save());
  console.log(`wrote ${OUT} (source ${shots[0].w}x${shots[0].h}px)`);
  process.exit(0);
}
main();
