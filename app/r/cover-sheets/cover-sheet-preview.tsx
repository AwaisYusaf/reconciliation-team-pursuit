import type { CSSProperties } from "react";

import { formatMoney } from "@/src/domain/format";
import { DOCUMENT_THEME as THEME } from "@/src/generation/document-theme";
import { COVER_COLUMN_SHARES } from "@/src/generation/layout-constants";

import { CoverSheetProofs } from "./cover-sheet-proofs";
import { SEE_BELOW, UI } from "@/src/domain/strings";
import type { CoverSheetRow } from "@/src/domain/cover-sheet";
import { coverSheetHeading } from "@/src/domain/strings";

export type PreviewProof = {
  id: string;
  filename: string;
  mimeType: string;
  /** Only images have a thumbnail; a PDF proof shows a labelled placeholder instead. */
  isImage: boolean;
};

export type PreviewRow = CoverSheetRow & {
  expenseId: string;
  proofs: PreviewProof[];
  /** Attached receipts, then attached supporting files: what the packet puts after the sheet
   *  for this expense (usability #42). Screen only. */
  followingDocuments: string[];
};

/**
 * The document's colours, read from the same supplier as the Word file (D-137), so the preview
 * cannot show one palette while the City receives another.
 */
const hex = (value: string) => `#${value}`;
const CELL: CSSProperties = { border: `1px solid ${hex(THEME.line)}` };
const HEADER_CELL: CSSProperties = {
  border: `1px solid ${hex(THEME.accent)}`,
  backgroundColor: hex(THEME.accent),
  color: hex(THEME.onAccent),
};
const TOTAL_CELL: CSSProperties = {
  ...CELL,
  borderTop: `1.5px solid ${hex(THEME.accent)}`,
  backgroundColor: hex(THEME.section),
};
const NOTE: CSSProperties = { backgroundColor: hex(THEME.section), color: hex(THEME.accent) };

/**
 * The Breakdown document rendered as HTML, matching the generated file 1:1.
 *
 * This preview is the product's trust-builder: what is seen here is what the City receives,
 * so it deliberately uses document styling rather than app styling — a serif-free document
 * face, ink on white, the same brown header band and tinted total and notes, the same
 * all-centered table. Any divergence between this and `cover-sheet-docx.ts` is a bug in one of
 * them.
 */
export function CoverSheetPreview({
  title,
  rows,
  totalCents,
  showMissingProofPlaceholders,
}: {
  title: string;
  rows: PreviewRow[];
  totalCents: number;
  /**
   * Screen only. A downloaded file never contains a placeholder — the gate guarantees
   * every expense has its proof before a download is possible (R4.1, R6.4).
   */
  showMissingProofPlaceholders: boolean;
}) {
  // Full width of the content column, not capped at 820px. Widening stays faithful to the
  // document rather than departing from it: the table's columns are the Word file's own
  // shares (`COVER_COLUMN_SHARES`), so a wider card renders the same proportions at a
  // larger size. The cap left a third of the screen empty beside the one thing this screen
  // exists to show.
  return (
    <div className="bg-white border border-line rounded-lg overflow-x-auto">
      {/*
        The document scrolls at a readable minimum rather than compressing to fit. Squeezing
        it into a phone's width put about eleven characters on a line of the Role column,
        which defeats the point of a preview that is meant to show exactly what the City
        receives. Padding steps down as well, since 40px each side was a quarter of the card.
      */}
      <div
        className="min-w-[560px] p-5 sm:p-8 lg:p-10 [font-family:Aptos,Calibri,Carlito,system-ui,sans-serif]"
        style={{ color: hex(THEME.ink) }}
      >
      <h2
        className="text-center font-bold text-[15px] mb-6 pb-2"
        style={{ borderBottom: `2px solid ${hex(THEME.accent)}` }}
      >
        {title}
      </h2>

      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {["Name", "Role", "Amount"].map((label, index) => (
              <th
                key={label}
                className="font-bold text-center p-1.5"
                style={{ ...HEADER_CELL, width: `${COVER_COLUMN_SHARES[index] * 100}%` }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.expenseId}>
              <td className="text-center p-1.5" style={CELL}>{row.name}</td>
              <td className="text-center p-1.5" style={CELL}>{row.role}</td>
              <td className="text-center p-1.5 tabular-nums" style={CELL}>
                {formatMoney(row.amountCents)}
              </td>
            </tr>
          ))}
          {/* Name and Role empty; the whole row is tinted, with a brown rule above it. */}
          <tr>
            <td className="p-1.5" style={TOTAL_CELL}>&nbsp;</td>
            <td className="p-1.5" style={TOTAL_CELL}>&nbsp;</td>
            <td className="font-bold text-center p-1.5 tabular-nums" style={TOTAL_CELL}>
              {formatMoney(totalCents)}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="text-[13px] mt-5">{SEE_BELOW}</p>

      {rows.map((row) => (
        <section key={row.expenseId} className="mt-6">
          <p className="text-[13px] font-bold">
            {coverSheetHeading(row.name, row.reference)}
            {row.notes.map((note) => (
              <span key={note} className="font-bold" style={NOTE}>
                {" "}
                {note}
              </span>
            ))}
          </p>

          {row.narrative && <p className="text-[13px] mt-1.5">{row.narrative}</p>}

          <CoverSheetProofs proofs={row.proofs} />

          {showMissingProofPlaceholders && row.proofs.length === 0 && (
            <div className="mt-2 border border-dashed border-danger text-danger px-3 py-5 text-[11px] text-center">
              Proof of payment missing
            </div>
          )}

          {/* Screen only: the packet adds these after the sheet (packet-pdf-spec §3...n); the
              cover sheet file itself does not contain them. */}
          {row.followingDocuments.length > 0 && (
            <p className="mt-2 text-[11px] text-sub font-sans">
              {UI.coverSheetFollowingDocs(row.followingDocuments)}
            </p>
          )}
        </section>
      ))}
      </div>
    </div>
  );
}
