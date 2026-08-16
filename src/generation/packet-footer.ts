/**
 * Page footers and the size ladder (packet-pdf-spec §Page numbering, §Size).
 *
 * Pure: operates on bytes, so both are testable without storage or a database.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { packetFooter } from "@/src/domain/strings";

import { inchesToPoints } from "./layout-constants";

const FOOTER_SIZE = 9;
const FOOTER_COLOR = rgb(0.47, 0.47, 0.47); // #787878
const FOOTER_FROM_BOTTOM = inchesToPoints(0.35);

/** DocuSign's envelope ceiling. */
export const MAX_PACKET_BYTES = 25 * 1024 * 1024;

/**
 * Stamp `{DocName} — {Month YYYY} — Page {i} of {N}` on every page (R10.5).
 *
 * Applied after assembly, which is the only point at which N is known — numbering pages as
 * sections are appended would print a total that later grows.
 */
export async function stampFooters(
  packet: Buffer,
  docName: string,
  monthLabel: string,
): Promise<Buffer> {
  const pdf = await PDFDocument.load(packet);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  pages.forEach((page, index) => {
    const text = packetFooter(docName, monthLabel, index + 1, pages.length);
    const width = font.widthOfTextAtSize(text, FOOTER_SIZE);
    page.drawText(text, {
      // Centred on the page's own width, so a page of any size is still centred.
      x: (page.getWidth() - width) / 2,
      y: FOOTER_FROM_BOTTOM,
      size: FOOTER_SIZE,
      font,
      color: FOOTER_COLOR,
    });
  });

  return Buffer.from(await pdf.save());
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
    `even at the lowest image quality. It has been downloaded anyway — DocuSign may reject it.`
  );
}
