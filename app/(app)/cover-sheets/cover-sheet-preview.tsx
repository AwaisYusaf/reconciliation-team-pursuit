import { formatMoney } from "@/src/domain/format";
import { SEE_BELOW } from "@/src/domain/strings";
import type { CoverSheetRow } from "@/src/domain/cover-sheet";

export type PreviewProof = {
  id: string;
  filename: string;
  /** Only images have a thumbnail; a PDF proof shows a labelled placeholder instead. */
  isImage: boolean;
};

export type PreviewRow = CoverSheetRow & {
  expenseId: string;
  proofs: PreviewProof[];
};

/**
 * The Breakdown document rendered as HTML, matching the generated file 1:1.
 *
 * This preview is the product's trust-builder: what is seen here is what the City receives,
 * so it deliberately uses document styling rather than app styling — a serif-free document
 * face, black text on white, the same yellow, the same all-centered table. Any divergence
 * between this and `cover-sheet-docx.ts` is a bug in one of them.
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
  return (
    <div className="bg-white border border-line rounded-lg max-w-[820px] overflow-x-auto">
      {/*
        The document scrolls at a readable minimum rather than compressing to fit. Squeezing
        it into a phone's width put about eleven characters on a line of the Role column,
        which defeats the point of a preview that is meant to show exactly what the City
        receives. Padding steps down as well, since 40px each side was a quarter of the card.
      */}
      <div className="min-w-[560px] p-5 sm:p-8 lg:p-10 text-black [font-family:Aptos,Calibri,Carlito,system-ui,sans-serif]">
      <h2 className="text-center font-bold text-[15px] mb-6">{title}</h2>

      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {["Name", "Role", "Amount"].map((label, index) => (
              <th
                key={label}
                className="border border-black bg-[#FFFF00] font-bold text-center p-1.5"
                style={{ width: ["24%", "61%", "15%"][index] }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.expenseId}>
              <td className="border border-black text-center p-1.5">{row.name}</td>
              <td className="border border-black text-center p-1.5">{row.role}</td>
              <td className="border border-black text-center p-1.5 tabular-nums">
                {formatMoney(row.amountCents)}
              </td>
            </tr>
          ))}
          {/* Name and Role empty, borders kept; only the Amount cell is shaded. */}
          <tr>
            <td className="border border-black p-1.5">&nbsp;</td>
            <td className="border border-black p-1.5">&nbsp;</td>
            <td className="border border-black bg-[#FFFF00] font-bold text-center p-1.5 tabular-nums">
              {formatMoney(totalCents)}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="text-[13px] mt-5">{SEE_BELOW}</p>

      {rows.map((row) => (
        <section key={row.expenseId} className="mt-6">
          <p className="text-[13px] font-bold">
            {row.name}:
            {row.notes.map((note) => (
              <span key={note} className="bg-[#FFFF00] font-bold">
                {" "}
                {note}
              </span>
            ))}
          </p>

          {row.narrative && <p className="text-[13px] mt-1.5">{row.narrative}</p>}

          {row.proofs.map((proof) =>
            proof.isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={proof.id}
                src={`/api/files/${proof.id}?thumb=1`}
                alt={proof.filename}
                className="block w-full h-auto mt-2 border border-line"
              />
            ) : (
              <div
                key={proof.id}
                className="mt-2 border border-line bg-surface-2 px-3 py-4 text-[11px] text-muted"
              >
                {proof.filename} — every page appears in the downloaded document
              </div>
            ),
          )}

          {showMissingProofPlaceholders && row.proofs.length === 0 && (
            <div className="mt-2 border border-dashed border-danger text-danger px-3 py-5 text-[11px] text-center">
              proof of payment missing
            </div>
          )}
        </section>
      ))}
      </div>
    </div>
  );
}
