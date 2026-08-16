import "server-only";

/**
 * Resolving an expense's proofs into embeddable images (R6.4).
 *
 * Kept apart from the generator so the generator stays pure: this is the only piece that
 * touches storage, and it is where a PDF proof becomes one image per page.
 */
import { storage } from "@/src/services/storage/driver";
import { keyBelongsToOrg } from "@/src/services/storage/keys";

import type { CoverImage } from "./cover-sheet-docx";
import type { SnapshotDocument, SnapshotExpense } from "./month-snapshot";
import { normalizeImage, rasterizePdf, type RasterQuality, DEFAULT_QUALITY } from "./raster";

/**
 * Proof documents only, in upload order (R6.4).
 *
 * Receipts and supporting documents belong to the packet's own sections, not to the cover
 * sheet — the sheet shows what proves the payment.
 */
export function proofDocuments(expense: SnapshotExpense): SnapshotDocument[] {
  return expense.documents
    .filter((document) => document.kind === "proof")
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/** Decode one stored document into the images it contributes. */
async function imagesFor(
  orgId: string,
  document: SnapshotDocument,
  quality: RasterQuality,
): Promise<CoverImage[]> {
  // Fails closed rather than returning no images: a cover sheet that silently omits a proof
  // looks complete and documents nothing.
  if (!keyBelongsToOrg(document.s3Key, orgId)) {
    throw new Error(`Refusing to include ${document.filename}: it does not belong to this organisation.`);
  }

  const bytes = await storage().get(document.s3Key);

  if (document.mimeType === "application/pdf") {
    const pages: CoverImage[] = [];
    await rasterizePdf(
      bytes,
      (page) => {
        pages.push({ data: page.jpeg, widthPx: page.widthPx, heightPx: page.heightPx });
      },
      quality,
      document.pageCount,
    );
    return pages;
  }

  const normalized = await normalizeImage(bytes, quality);
  return [{ data: normalized.jpeg, widthPx: normalized.widthPx, heightPx: normalized.heightPx }];
}

/**
 * Proof images for each expense, index-aligned with the rows the sheet prints.
 *
 * Expenses are processed one at a time rather than all at once: a line item can hold dozens
 * of multi-page statements, and rasterising them concurrently would multiply peak memory by
 * the number of expenses for no useful gain.
 */
export async function loadProofImages(
  orgId: string,
  expenses: readonly SnapshotExpense[],
  quality: RasterQuality = DEFAULT_QUALITY,
): Promise<CoverImage[][]> {
  const perExpense: CoverImage[][] = [];

  for (const expense of expenses) {
    const images: CoverImage[] = [];
    for (const document of proofDocuments(expense)) {
      images.push(...(await imagesFor(orgId, document, quality)));
    }
    perExpense.push(images);
  }

  return perExpense;
}
