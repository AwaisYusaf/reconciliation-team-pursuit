"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/src/components/ui/button";
import { isPdf, isPreviewableImage } from "@/src/services/storage/preview";

/**
 * Full-screen viewer for an attached receipt, invoice or proof.
 *
 * The point is confirmation before committing: the upload list used to show a filename and a
 * grey square, so the only way to check you had attached the right scan was to save and
 * reopen it. A file queued on the form has not been uploaded yet, so its preview comes from a
 * blob URL in the browser; an already-stored one comes from `/api/files/{id}?inline=1`.
 */

export { isPdf, isPreviewableImage, inlineSrc, thumbnailSrc } from "@/src/services/storage/preview";

export type ViewerDocument = {
  /** Blob URL for a queued file, or the inline API URL for a stored one. */
  src: string | null;
  filename: string;
  mimeType: string;
  /** Shown instead of a preview when the browser cannot render this file itself. */
  unavailable?: string;
};

/**
 * The small square beside a filename: the image itself where there is one, a glyph where
 * there is not. Never an `<img>` pointed at something that will 404 — which is what a stored
 * PDF used to get, since PDFs have no stored thumbnail (rasterising needs poppler, which only
 * the packet pipeline runs). Every PDF receipt showed a broken image icon.
 */
export function DocumentThumbnail({
  src,
  pdf,
  size = "md",
}: {
  src: string | null;
  pdf: boolean;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "w-7 h-7" : "w-10 h-10";

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={`${box} flex-none object-cover border border-line rounded-[2px] bg-section`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${box} flex-none border border-line rounded-[2px] bg-section flex items-center justify-center font-bold text-sub ${
        size === "sm" ? "text-[9px]" : "text-[11px]"
      }`}
    >
      {pdf ? "PDF" : "FILE"}
    </span>
  );
}

function DocumentViewerOverlay({
  documents,
  index,
  onIndexChange,
  onClose,
}: {
  documents: ViewerDocument[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const current = documents[index];
  const closeRef = useRef<HTMLButtonElement>(null);
  // Focus is taken by the dialog, so it has to go back where it came from on close —
  // otherwise a keyboard user is returned to the top of the document.
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => returnFocusTo.current?.focus?.();
  }, []);

  // The page behind must not scroll while the overlay is up, on touch as well as wheel.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (documents.length < 2) return;
      if (event.key === "ArrowRight") onIndexChange((index + 1) % documents.length);
      if (event.key === "ArrowLeft") onIndexChange((index - 1 + documents.length) % documents.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [documents.length, index, onClose, onIndexChange]);

  if (!current) return null;

  const showPreview = current.src && !current.unavailable;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${current.filename} — attachment preview`}
      className="fixed inset-0 z-50 bg-black/90 flex flex-col"
      onClick={(event) => {
        // Only the backdrop itself closes; a click that started on the image must not.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3 bg-black text-white flex-none">
        <div className="flex-1 min-w-0">
          <div className="text-[15px] truncate">{current.filename}</div>
          {documents.length > 1 && (
            <div className="text-sm text-white/70">
              {index + 1} of {documents.length}
            </div>
          )}
        </div>

        {current.src && (
          // iOS Safari renders only the first page of a PDF in an iframe, and some browsers
          // refuse to frame one at all. This is the way out of both.
          <a
            href={current.src}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[15px] underline underline-offset-2 min-h-11 flex items-center px-2 text-white"
          >
            Open in new tab
          </a>
        )}

        <Button
          ref={closeRef}
          variant="secondary"
          className="min-h-11"
          onClick={onClose}
          aria-label="Close preview"
        >
          Close
        </Button>
      </div>

      <div
        className="flex-1 min-h-0 flex items-center justify-center p-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {showPreview && isPdf(current.mimeType) && (
          // `object` rather than `iframe` because it has a defined fallback: a browser that
          // will not display a PDF inline shows the children below instead of an empty frame.
          // Several do exactly that — the embedded browser this was tested in downloads PDFs
          // regardless of `Content-Disposition: inline`, and iOS Safari renders only page one.
          <object
            data={current.src ?? ""}
            type="application/pdf"
            aria-label={current.filename}
            className="w-full h-full bg-white rounded-[3px]"
          >
            <div className="w-full h-full flex items-center justify-center p-6">
              <p className="text-center text-ink text-[15px] max-w-[420px]">
                This browser will not display a PDF here.{" "}
                <a
                  href={current.src ?? ""}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline underline-offset-2"
                >
                  Open {current.filename} in a new tab
                </a>{" "}
                to read it.
              </p>
            </div>
          </object>
        )}

        {showPreview && isPreviewableImage(current.mimeType) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.src ?? ""}
            alt={current.filename}
            className="max-w-full max-h-full object-contain"
          />
        )}

        {(!showPreview ||
          (!isPdf(current.mimeType) && !isPreviewableImage(current.mimeType))) && (
          <div className="text-center text-white/80 text-[15px] max-w-[420px]">
            {current.unavailable ??
              "This file cannot be previewed in the browser. Use “Open in new tab” to download it."}
          </div>
        )}
      </div>

      {documents.length > 1 && (
        <div className="flex items-center justify-center gap-3 px-4 py-3 bg-black flex-none">
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => onIndexChange((index - 1 + documents.length) % documents.length)}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => onIndexChange((index + 1) % documents.length)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Owns the viewer's open/closed state and renders it into `document.body`.
 *
 * A portal because the overlay must escape the table cell or form row it is opened from —
 * an ancestor with `overflow: hidden` or a stacking context would otherwise clip it.
 */
export function useDocumentViewer() {
  const [state, setState] = useState<{ documents: ViewerDocument[]; index: number } | null>(null);

  const open = useCallback((documents: ViewerDocument[], index = 0) => {
    if (documents.length > 0) setState({ documents, index });
  }, []);

  const close = useCallback(() => setState(null), []);

  // No "have we mounted yet" guard: `state` is only ever set by a click, so it is null
  // through server rendering and hydration, and `createPortal` is never reached there.
  const viewer = state
    ? createPortal(
        <DocumentViewerOverlay
          documents={state.documents}
          index={state.index}
          onIndexChange={(index) => setState((current) => (current ? { ...current, index } : current))}
          onClose={close}
        />,
        document.body,
      )
    : null;

  return { open, close, viewer };
}
