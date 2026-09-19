/**
 * Page footers and the size ladder (packet-pdf-spec §Page numbering, §Size).
 *
 * Pure: operates on bytes, so both are testable without storage or a database.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { packetFooter } from "@/src/domain/strings";

import { inchesToPoints } from "./layout-constants";
import type { PacketNavigation, PacketPage } from "./packet-pdf";
import { addInternalLink, addOutline, type OutlineItem, type Target } from "./pdf-links";
import { winAnsiSafe } from "./pdf-text";

const FOOTER_SIZE = 9;
const FOOTER_COLOR = rgb(0.47, 0.47, 0.47); // #787878
const FOOTER_FROM_BOTTOM = inchesToPoints(0.35);

/** DocuSign's envelope ceiling. */
export const MAX_PACKET_BYTES = 25 * 1024 * 1024;

/**
 * Stamp `{DocName} | {Month YYYY} | [{reference} |] Page {i} of {N}` on every page (R10.5, D-113).
 *
 * Applied after assembly, which is the only point at which N is known — numbering pages as
 * sections are appended would print a total that later grows.
 *
 * `pageOwners` carries the expense each page documents, collected during assembly because
 * nothing about a merged, rasterised receipt says where it came from. A page belonging to no
 * single expense simply gets the footer it always had.
 */
/**
 * Draw one page's footer. Returns where the reference token sits, when there is one, so the
 * back-link can be placed on exactly the text a reader would click — measured with the same
 * font and size that drew it, which is why the link and the text cannot disagree (D-83).
 */
function drawFooter(
  page: PDFPage,
  font: PDFFont,
  docName: string,
  monthLabel: string,
  index: number,
  count: number,
  reference: string | null,
): { x: number; width: number } | null {
  const text = winAnsiSafe(packetFooter(docName, monthLabel, index + 1, count, reference));
  const width = font.widthOfTextAtSize(text, FOOTER_SIZE);
  // Centred on the page's own width, so a page of any size is still centred.
  const x = (page.getWidth() - width) / 2;
  page.drawText(text, { x, y: FOOTER_FROM_BOTTOM, size: FOOTER_SIZE, font, color: FOOTER_COLOR });

  if (!reference) return null;
  const at = text.indexOf(reference);
  if (at < 0) return null;
  return {
    x: x + font.widthOfTextAtSize(text.slice(0, at), FOOTER_SIZE),
    width: font.widthOfTextAtSize(reference, FOOTER_SIZE),
  };
}

export async function stampFooters(
  packet: Buffer,
  docName: string,
  monthLabel: string,
  pageOwners: ReadonlyArray<string | null> = [],
): Promise<Buffer> {
  const pdf = await PDFDocument.load(packet);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  pages.forEach((page, index) =>
    drawFooter(page, font, docName, monthLabel, index, pages.length, pageOwners[index] ?? null),
  );
  const saved = await pdf.save();
  return Buffer.from(saved.buffer, saved.byteOffset, saved.byteLength);
}

/** How far the footer link box extends beyond the glyphs, so it is comfortable to hit. */
const LINK_PAD = 2;

/**
 * Finish the assembled packet: footers on every page, the links, and the outline, in one
 * load and one save (R10.5a, D-83).
 *
 * This is the only stage at which every page exists and nothing will be copied again — the
 * two conditions a link needs (`pdf-links.ts`). Targets:
 *
 *   cover-sheet row and heading  → the expense's first evidence page; with no evidence (R4.4),
 *                                  its own heading, where the proof is
 *   evidence-page footer reference → back to the heading
 *   index Ref cell               → the heading; for a no-receipt expense, its D-74 line
 *
 * Every link is derived from the same page map the footers are drawn from, so a footer that
 * names an expense and a link that lands on it can only agree.
 */
export async function finishPacket(
  packet: Buffer,
  docName: string,
  monthLabel: string,
  map: { pages: readonly PacketPage[]; navigation: PacketNavigation },
): Promise<Buffer> {
  const pdf = await PDFDocument.load(packet);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const { navigation } = map;

  const firstEvidence = new Map<string, number>();
  const firstOf = (kind: PacketPage["kind"]) => map.pages.findIndex((page) => page.kind === kind);
  map.pages.forEach((page, index) => {
    if ((page.kind === "receipt" || page.kind === "supporting") && !firstEvidence.has(page.reference)) {
      firstEvidence.set(page.reference, index);
    }
  });
  const byReference = new Map(navigation.expenses.map((expense) => [expense.reference, expense]));
  const headingOf = (expense: PacketNavigation["expenses"][number]): Target => ({
    page: pages[expense.heading.page],
    top: expense.heading.top,
  });
  /** Where a click on the expense goes: its evidence, or — with none — its heading (Q6). */
  const evidenceOf = (expense: PacketNavigation["expenses"][number]): Target => {
    const first = firstEvidence.get(expense.reference);
    return first === undefined ? headingOf(expense) : { page: pages[first] };
  };

  // Footers, and the back-link on every evidence page.
  pages.forEach((page, index) => {
    const entry = map.pages[index];
    const reference = entry && (entry.kind === "receipt" || entry.kind === "supporting") ? entry.reference : null;
    const token = drawFooter(page, font, docName, monthLabel, index, pages.length, reference);
    const expense = reference ? byReference.get(reference) : undefined;
    if (token && expense) {
      addInternalLink(
        pdf,
        page,
        {
          x: token.x - LINK_PAD,
          y: FOOTER_FROM_BOTTOM - LINK_PAD,
          width: token.width + LINK_PAD * 2,
          height: FOOTER_SIZE + LINK_PAD * 2,
        },
        headingOf(expense),
      );
    }
  });

  // Cover sheets: the row and the heading.
  for (const expense of navigation.expenses) {
    addInternalLink(pdf, pages[expense.row.page], expense.row.rect, evidenceOf(expense));
    addInternalLink(pdf, pages[expense.heading.page], expense.heading.rect, evidenceOf(expense));
  }

  // The index: Ref cells, and the disclosure line for a no-receipt expense.
  const disclosures = new Map(navigation.index.disclosures.map((line) => [line.reference, line]));
  for (const cell of navigation.index.refCells) {
    const expense = byReference.get(cell.reference);
    if (!expense) continue;
    const line = expense.noReceipt ? disclosures.get(cell.reference) : undefined;
    const target: Target = line ? { page: pages[line.page], top: line.top } : headingOf(expense);
    addInternalLink(pdf, pages[cell.page], cell.rect, target);
  }

  // The outline: what a reader sees in the sidebar. Every section entry is looked up in the page
  // map rather than assumed, so a hidden section (D-114) gets no bookmark instead of lending its
  // name to whatever page happens to come first.
  const items: OutlineItem[] = [];
  const firstSummary = firstOf("summary");
  if (firstSummary >= 0) items.push({ title: "Contract summary", target: { page: pages[firstSummary] } });
  const firstIndex = firstOf("index");
  if (firstIndex >= 0) items.push({ title: "Expense index", target: { page: pages[firstIndex] } });
  for (const lineItem of navigation.lineItems) {
    items.push({
      title: lineItem.name,
      target: { page: pages[lineItem.firstCoverPage] },
      children: navigation.expenses
        .filter((expense) => expense.lineItemId === lineItem.lineItemId)
        .map((expense) => ({ title: `${expense.reference} | ${expense.name}`, target: headingOf(expense) })),
    });
  }
  const firstMonth = firstOf("month");
  if (firstMonth >= 0) items.push({ title: "Month documents", target: { page: pages[firstMonth] } });
  addOutline(pdf, items);

  const saved = await pdf.save();
  return Buffer.from(saved.buffer, saved.byteOffset, saved.byteLength);
}

export type SizeOutcome = {
  /** The step actually delivered, 0-based against the raster ladder. */
  step: number;
  /** Set when even the last step exceeded the ceiling — the packet is delivered anyway. */
  oversizeWarning: string | null;
};

/** Human-readable megabytes for the warning the screen shows. */
export function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The warning shown when the last ladder step is still over the ceiling.
 *
 * The packet is delivered regardless: a large packet the organisation can try to submit is
 * more useful than no packet at all, and only they know whether DocuSign accepted it.
 */
export function oversizeWarning(bytes: number): string {
  return (
    `This packet is ${formatBytes(bytes)}, above DocuSign's ${formatBytes(MAX_PACKET_BYTES)} limit ` +
    `even at the lowest image quality. It has been downloaded anyway, but DocuSign may reject it.`
  );
}
