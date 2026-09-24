"use client";

import { inlineSrc, useDocumentViewer } from "@/src/components/ui/document-viewer";

import type { PreviewProof } from "./cover-sheet-preview";

/**
 * The proof images beneath one row of the cover sheet preview, made inspectable.
 *
 * Rendered exactly as the document renders them — no borders, badges or hover chrome beyond
 * a pointer cursor. That preview's whole claim is that what is on screen is what the City
 * receives, so anything visible added here would undermine it. What is added is invisible:
 * the image becomes a click target, and a PDF proof — which the document can only represent
 * as a line of text — becomes openable, since otherwise there is no way to see it from this
 * screen at all.
 */
export function CoverSheetProofs({ proofs }: { proofs: PreviewProof[] }) {
  const { open, viewer } = useDocumentViewer();

  const documents = proofs.map((proof) => ({
    src: inlineSrc(proof.id),
    filename: proof.filename,
    mimeType: proof.mimeType,
  }));

  return (
    <>
      {proofs.map((proof, position) =>
        proof.isImage ? (
          <button
            key={proof.id}
            type="button"
            onClick={() => open(documents, position)}
            title={`Preview ${proof.filename}`}
            className="block w-full mt-2 cursor-zoom-in"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/files/${proof.id}?thumb=1`}
              alt={proof.filename}
              className="block w-full h-auto border border-line"
            />
          </button>
        ) : (
          <button
            key={proof.id}
            type="button"
            onClick={() => open(documents, position)}
            title={`Preview ${proof.filename}`}
            className="block w-full mt-2 border border-line bg-surface-2 px-3 py-4 text-[11px] text-sub text-left cursor-zoom-in"
          >
            {proof.filename} (every page appears in the downloaded document)
          </button>
        ),
      )}

      {viewer}
    </>
  );
}
