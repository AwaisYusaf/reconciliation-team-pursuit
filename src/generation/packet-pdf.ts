import "server-only";

/**
 * Month-end packet assembly — implements docs/02-outputs/packet-pdf-spec.md.
 *
 * The single merged PDF the organisation uploads to DocuSign. Generated sections (summary,
 * cover sheets) are copied as vector text so they stay selectable and tiny; uploaded files
 * are rasterised to one packet page per source page, which is also what strips any active
 * content they carried (D-20).
 *
 * Memory is the binding constraint: a month can hold hundreds of pages. Documents are
 * processed one at a time and `rasterizePdf` yields page by page, so peak usage is one page
 * of image data rather than a whole packet.
 */
import { PDFDocument, type PDFImage } from "pdf-lib";

import { coverSheetRows } from "@/src/domain/cover-sheet";
import { monthLabel } from "@/src/domain/dates";
import { coverSheetTitle, expenseReference } from "@/src/domain/strings";
import { storage } from "@/src/services/storage/driver";
import { keyBelongsToOrg } from "@/src/services/storage/keys";

import { buildCoverSheetDocx } from "./cover-sheet-docx";
import { loadProofImages } from "./cover-sheet-images";
import { convertDocxToPdf } from "./docx-to-pdf";
import { PACKET_MARGIN_IN, inchesToPoints } from "./layout-constants";
import { expensesForLineItem, type MonthSnapshot } from "./month-snapshot";
import { orderedMonthDocuments, packetDocumentsFor } from "./packet-order";
import { coverSheetAnchors } from "./pdf-anchors";
import type { Rect } from "./pdf-links";
import { buildIndexSection } from "./packet-index-pdf";
import { buildSummarySectionPdf } from "./packet-summary-pdf";
import { DEFAULT_QUALITY, normalizeImage, rasterizePdf, type RasterQuality } from "./raster";

const PAGE_WIDTH = inchesToPoints(8.5);
const PAGE_HEIGHT = inchesToPoints(11);
const MARGIN = inchesToPoints(PACKET_MARGIN_IN);
const MAX_IMAGE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const MAX_IMAGE_HEIGHT = PAGE_HEIGHT - MARGIN * 2;

/** Rasterised pages arrive at this DPI, which is what converts pixels back to points. */
function pointsFor(pixels: number, dpi: number): number {
  return (pixels / dpi) * 72;
}

export class PacketError extends Error {
  /** Which section or file failed, for the message the packet screen shows. */
  readonly at: string;

  constructor(at: string, cause: unknown) {
    super(`Packet generation failed at ${at}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "PacketError";
    this.at = at;
  }
}

/**
 * Add one full page holding a single image, centred within the margins.
 *
 * Never upscaled: a small receipt blown up to the full page would only magnify its
 * compression artefacts and read worse than it does at its natural size.
 */
function addImagePage(
  pdf: PDFDocument,
  image: PDFImage,
  natural: { widthPt: number; heightPt: number },
): void {
  const scale = Math.min(
    MAX_IMAGE_WIDTH / natural.widthPt,
    MAX_IMAGE_HEIGHT / natural.heightPt,
    1,
  );
  const width = natural.widthPt * scale;
  const height = natural.heightPt * scale;

  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawImage(image, {
    x: (PAGE_WIDTH - width) / 2,
    y: (PAGE_HEIGHT - height) / 2,
    width,
    height,
  });
}

/** Append every page an uploaded document contributes. */
async function appendUpload(
  pdf: PDFDocument,
  orgId: string,
  document: { s3Key: string; mimeType: string; filename: string; pageCount: number | null },
  quality: RasterQuality,
): Promise<void> {
  // The key came from our own row, so this should be unreachable. It fails closed anyway:
  // a guard that exists to catch "this evidence does not belong here" must never resolve
  // by quietly leaving the document out of a claim.
  if (!keyBelongsToOrg(document.s3Key, orgId)) {
    throw new Error(`Refusing to include ${document.filename}: it does not belong to this organisation.`);
  }

  const bytes = await storage().get(document.s3Key);

  if (document.mimeType === "application/pdf") {
    await rasterizePdf(
      bytes,
      async (page) => {
        const embedded = await pdf.embedJpg(page.jpeg);
        addImagePage(pdf, embedded, {
          widthPt: pointsFor(page.widthPx, quality.dpi),
          heightPt: pointsFor(page.heightPx, quality.dpi),
        });
      },
      quality,
      // Checked against what was recorded when the file was attached.
      document.pageCount,
    );
    return;
  }

  const normalized = await normalizeImage(bytes, quality);
  const embedded = await pdf.embedJpg(normalized.jpeg);
  // An uploaded photo has no meaningful DPI, so it is measured at 96 — the same assumption
  // browsers make — rather than pretending it was scanned at the raster DPI.
  addImagePage(pdf, embedded, {
    widthPt: pointsFor(normalized.widthPx, 96),
    heightPt: pointsFor(normalized.heightPx, 96),
  });
}

/** Copy a generated PDF's pages in, keeping them as vector text. */
async function appendGenerated(pdf: PDFDocument, source: Buffer): Promise<void> {
  const loaded = await PDFDocument.load(source);
  const pages = await pdf.copyPages(loaded, loaded.getPageIndices());
  for (const page of pages) pdf.addPage(page);
}

/**
 * What one packet page is, recorded as it is appended (D-83).
 *
 * Collected during assembly because that is the only point at which it is known: once the
 * pages are merged, nothing about a rasterised receipt says which expense it came from, and
 * nothing about a copied cover sheet says which line item it covers. The finishing pass reads
 * this to stamp footers (R10.5) and to draw the links and outline (R10.5a) — one map, so the
 * footer on a page and the link that lands on it cannot describe different pages.
 */
type Evidence = { reference: string; expenseId: string; documentId: string };

export type PacketPage =
  | { kind: "summary" }
  | { kind: "index" }
  | { kind: "cover"; lineItemId: string }
  // Two members, not one with a union `kind`: a discriminant that is itself a union inside one
  // member does not discriminate, so `Extract` and `switch` could never tell them apart.
  | ({ kind: "receipt" } & Evidence)
  | ({ kind: "supporting" } & Evidence)
  | { kind: "month"; documentId: string };

/**
 * Everything the finishing pass needs to draw the links and the outline (R10.5a, D-83), with
 * every page number already translated into the packet's own numbering.
 *
 * Recorded during assembly because that is the only point at which both halves exist: the
 * anchors are measured on a cover sheet before it is copied in, and the page it lands on is
 * known only as it is appended.
 */
export type PacketNavigation = {
  index: {
    refCells: Array<{ reference: string; page: number; rect: Rect }>;
    disclosures: Array<{ reference: string; page: number; rect: Rect; top: number }>;
  };
  lineItems: Array<{ lineItemId: string; name: string; firstCoverPage: number }>;
  expenses: Array<{
    reference: string;
    expenseId: string;
    name: string;
    lineItemId: string;
    noReceipt: boolean;
    row: { page: number; rect: Rect };
    heading: { page: number; rect: Rect; top: number };
  }>;
};

export type PacketResult = {
  pdf: Buffer;
  pageCount: number;
  /** One entry per page index, in page order. */
  pages: PacketPage[];
  navigation: PacketNavigation;
  /**
   * The expense reference each page belongs to, by page index — null for pages that belong to
   * no single expense. Derived from `pages`, never recorded separately, so it cannot drift from
   * the map the links are drawn from.
   */
  pageOwners: Array<string | null>;
};

/** The reference a page documents, or null for a page that belongs to no single expense. */
export function pageReference(page: PacketPage): string | null {
  return page.kind === "receipt" || page.kind === "supporting" ? page.reference : null;
}

/** Assemble the packet in canonical order. */
export async function buildPacketPdf(
  snapshot: MonthSnapshot,
  quality: RasterQuality = DEFAULT_QUALITY,
): Promise<PacketResult> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${snapshot.docName} ${monthLabel(snapshot.month)} Packet`);
  const label = monthLabel(snapshot.month);

  const pages: PacketPage[] = [];
  const navigation: PacketNavigation = { index: { refCells: [], disclosures: [] }, lineItems: [], expenses: [] };
  /** Record whatever pages `append` adds as `entry`. */
  async function owned(entry: PacketPage, append: () => Promise<void>): Promise<void> {
    const before = pdf.getPageCount();
    await append();
    for (let index = before; index < pdf.getPageCount(); index += 1) {
      pages[index] = entry;
    }
  }

  /* ------------------------------------------------ 1. contract summary */
  try {
    await owned({ kind: "summary" }, async () =>
      appendGenerated(pdf, await buildSummarySectionPdf(snapshot)),
    );
  } catch (error) {
    throw new PacketError("the contract summary section", error);
  }

  /* --------------------------------------------------- 2. expense index */
  // Directly after the summary, where a contents page belongs: a reviewer meets the totals,
  // then the list of what makes them up, then the evidence.
  try {
    const index = await buildIndexSection(snapshot);
    const firstIndexPage = pdf.getPageCount();
    await owned({ kind: "index" }, async () => appendGenerated(pdf, index.pdf));
    navigation.index = {
      refCells: index.anchors.refCells.map((cell) => ({ ...cell, page: firstIndexPage + cell.page })),
      disclosures: index.anchors.disclosures.map((line) => ({ ...line, page: firstIndexPage + line.page })),
    };
  } catch (error) {
    throw new PacketError("the expense index section", error);
  }

  /* --------------------------------------- 3..n. one section per line item */
  for (const lineItem of snapshot.lineItems) {
    const expenses = expensesForLineItem(snapshot, lineItem.id);
    // Line items with nothing recorded this month are simply omitted.
    if (expenses.length === 0) continue;

    try {
      const composed = coverSheetRows(expenses, snapshot.month);
      const docx = await buildCoverSheetDocx({
        title: coverSheetTitle(snapshot.docName, label, lineItem.name),
        rows: composed.rows,
        totalCents: composed.totalCents,
        images: await loadProofImages(snapshot.orgId, expenses, quality),
      });
      // Anchors are measured on the converted sheet *before* it is copied in: the copy keeps
      // the geometry but the links must be added to the packet's own pages (D-83).
      const sheet = await convertDocxToPdf(docx);
      const anchors = coverSheetAnchors(sheet, composed.rows);
      const firstCoverPage = pdf.getPageCount();
      // The cover sheet covers the whole category, so it carries no single reference — it is
      // recorded against its line item, which is what the outline and the back-links need.
      await owned({ kind: "cover", lineItemId: lineItem.id }, async () => appendGenerated(pdf, sheet));
      navigation.lineItems.push({ lineItemId: lineItem.id, name: lineItem.name, firstCoverPage });
      expenses.forEach((expense, position) => {
        const anchor = anchors[position];
        navigation.expenses.push({
          reference: composed.rows[position].reference,
          expenseId: expense.id,
          name: expense.name,
          lineItemId: lineItem.id,
          noReceipt: expense.noReceipt,
          row: { page: firstCoverPage + anchor.row.page, rect: anchor.row.rect },
          heading: {
            page: firstCoverPage + anchor.heading.page,
            rect: anchor.heading.rect,
            top: anchor.heading.top,
          },
        });
      });
    } catch (error) {
      throw new PacketError(`the ${lineItem.name} cover sheet`, error);
    }

    for (const expense of expenses) {
      for (const document of packetDocumentsFor(expense)) {
        try {
          const evidence = {
            reference: expenseReference(snapshot.month, expense.referenceSeq),
            expenseId: expense.id,
            documentId: document.id,
          };
          await owned(
            document.kind === "receipt"
              ? { kind: "receipt", ...evidence }
              : { kind: "supporting", ...evidence },
            async () => appendUpload(pdf, snapshot.orgId, document, quality),
          );
        } catch (error) {
          throw new PacketError(`${expense.name} — ${document.filename}`, error);
        }
      }
    }
  }

  /* ------------------------------------------- last. month documents (D-77) */
  // Month-level backup — bank statements, timesheets — goes behind the claim it supports, so
  // the packet opens on the summary and the cover letters rather than on a bank statement.
  // It used to sit ahead of the first cover sheet, which is what the client asked us to fix.
  for (const document of orderedMonthDocuments(snapshot.monthDocuments)) {
    try {
      // A month document belongs to the month, not to any one expense, so it owns no reference.
      await owned({ kind: "month", documentId: document.id }, async () =>
        appendUpload(pdf, snapshot.orgId, document, quality),
      );
    } catch (error) {
      throw new PacketError(document.title || document.filename, error);
    }
  }

  // Wrapped, not copied: `save()` already returns a fresh array, and copying a 100 MB
  // packet again doubles peak memory at the worst possible moment.
  const saved = await pdf.save();
  const bytes = Buffer.from(saved.buffer, saved.byteOffset, saved.byteLength);
  return { pdf: bytes, pageCount: pdf.getPageCount(), pages, navigation, pageOwners: pages.map(pageReference) };
}
