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
import { coverSheetTitle } from "@/src/domain/strings";
import { storage } from "@/src/services/storage/driver";
import { keyBelongsToOrg } from "@/src/services/storage/keys";

import { buildCoverSheetDocx } from "./cover-sheet-docx";
import { loadProofImages } from "./cover-sheet-images";
import { convertDocxToPdf } from "./docx-to-pdf";
import { PACKET_MARGIN_IN, inchesToPoints } from "./layout-constants";
import { expensesForLineItem, type MonthSnapshot } from "./month-snapshot";
import { orderedMonthDocuments, packetDocumentsFor } from "./packet-order";
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

export type PacketResult = {
  pdf: Buffer;
  pageCount: number;
};

/** Assemble the packet in canonical order. */
export async function buildPacketPdf(
  snapshot: MonthSnapshot,
  quality: RasterQuality = DEFAULT_QUALITY,
): Promise<PacketResult> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${snapshot.docName} ${monthLabel(snapshot.month)} Packet`);
  const label = monthLabel(snapshot.month);

  /* ------------------------------------------------ 1. contract summary */
  try {
    await appendGenerated(pdf, await buildSummarySectionPdf(snapshot));
  } catch (error) {
    throw new PacketError("the contract summary section", error);
  }

  /* -------------------------------------------------- 2. month documents */
  for (const document of orderedMonthDocuments(snapshot.monthDocuments)) {
    try {
      await appendUpload(pdf, snapshot.orgId, document, quality);
    } catch (error) {
      throw new PacketError(document.title || document.filename, error);
    }
  }

  /* --------------------------------------- 3..n. one section per line item */
  for (const lineItem of snapshot.lineItems) {
    const expenses = expensesForLineItem(snapshot, lineItem.id);
    // Line items with nothing recorded this month are simply omitted.
    if (expenses.length === 0) continue;

    try {
      const composed = coverSheetRows(expenses);
      const docx = await buildCoverSheetDocx({
        title: coverSheetTitle(snapshot.docName, label, lineItem.name),
        rows: composed.rows,
        totalCents: composed.totalCents,
        images: await loadProofImages(snapshot.orgId, expenses, quality),
      });
      await appendGenerated(pdf, await convertDocxToPdf(docx));
    } catch (error) {
      throw new PacketError(`the ${lineItem.name} cover sheet`, error);
    }

    for (const expense of expenses) {
      for (const document of packetDocumentsFor(expense)) {
        try {
          await appendUpload(pdf, snapshot.orgId, document, quality);
        } catch (error) {
          throw new PacketError(`${expense.name} — ${document.filename}`, error);
        }
      }
    }
  }

  // Wrapped, not copied: `save()` already returns a fresh array, and copying a 100 MB
  // packet again doubles peak memory at the worst possible moment.
  const saved = await pdf.save();
  const bytes = Buffer.from(saved.buffer, saved.byteOffset, saved.byteLength);
  return { pdf: bytes, pageCount: pdf.getPageCount() };
}
