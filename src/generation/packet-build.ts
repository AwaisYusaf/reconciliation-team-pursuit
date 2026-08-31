import "server-only";

/**
 * Building a deliverable packet: assemble, stamp, and step the image quality down if the
 * result is too large for DocuSign (packet-pdf-spec §Size).
 */
import { monthLabel } from "@/src/domain/dates";

import {
  MAX_PACKET_BYTES,
  oversizeWarning,
  stampFooters,
} from "./packet-footer";
import type { MonthSnapshot } from "./month-snapshot";
import { buildPacketPdf } from "./packet-pdf";
import { RASTER_LADDER } from "./raster";

export type BuiltPacket = {
  pdf: Buffer;
  pageCount: number;
  /** Index into the raster ladder that was actually delivered. */
  step: number;
  /** Set only when the final step is still over the ceiling. */
  warning: string | null;
};

/**
 * Build the packet, retrying at lower image quality while it exceeds the ceiling.
 *
 * The last step is delivered whatever its size — never blocking the download on size is a
 * deliberate rule: the organisation can still try to submit a large packet, and only they
 * find out whether DocuSign took it.
 */
export async function buildDeliverablePacket(snapshot: MonthSnapshot): Promise<BuiltPacket> {
  const label = monthLabel(snapshot.month);
  let last: BuiltPacket | null = null;

  for (const [step, quality] of RASTER_LADDER.entries()) {
    const assembled = await buildPacketPdf(snapshot, quality);
    const pdf = await stampFooters(
      assembled.pdf,
      snapshot.docName,
      label,
      assembled.pageOwners,
    );

    last = { pdf, pageCount: assembled.pageCount, step, warning: null };
    if (pdf.byteLength <= MAX_PACKET_BYTES) return last;
  }

  // Every step overshot; deliver the smallest one with an honest warning.
  return { ...last!, warning: oversizeWarning(last!.pdf.byteLength) };
}
