"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/src/components/ui/button";
import { ConfirmButton } from "@/src/components/ui/confirm-button";
import {
  DocumentThumbnail,
  inlineSrc,
  isPdf,
  isPreviewableImage,
  thumbnailSrc,
  useDocumentViewer,
  type ViewerDocument,
} from "@/src/components/ui/document-viewer";
import {
  PLUS_FRAME_STYLE,
  PLUS_GRADIENT_TEXT,
  PlusBadge,
  SparkleIcon,
} from "@/src/components/ui/plus-badge";
import { Select } from "@/src/components/ui/select";
import type { FileReadResult } from "@/src/domain/amount-suggestion";
import { formatMoney } from "@/src/domain/format";
import { UI } from "@/src/domain/strings";
import { cn } from "@/src/lib/cn";
import {
  isAllowedMimeType,
  MAX_UPLOAD_BYTES,
  type DocumentScope,
} from "@/src/services/storage/keys";

import { heicToJpegFile, looksLikeHeic } from "./heic-to-jpeg";
import type { AttachedDocument } from "./queries";

export type PendingUpload = {
  key: string;
  scope: DocumentScope;
  supportingType?: string;
  file: File;
  /**
   * Blob URL for previewing this file before it is uploaded, when the browser can decode it.
   * Minted when the file is picked — creating one is a side effect, so it belongs in the
   * event handler rather than in render.
   */
  previewUrl?: string;
  /** A HEIC still being converted to JPEG in the browser. The form holds Save and the AI read
   *  until it's done — saving mid-conversion lost the photo (PR #18 round 2, #6). */
  converting?: boolean;
};

/**
 * Multi-file upload field.
 *
 * Files chosen on the add form are queued in the browser and uploaded once the expense
 * exists; in edit mode the expense is already there, so the same queue is flushed on save.
 * Already-attached files are listed with their page counts. Removing one deletes it for real
 * — the row, the stored file and its thumbnail — so it asks first, naming the file. It used to
 * go on the first click, with a line of helper text carrying the warning; a client destroyed a
 * receipt by misclicking it. Queued files are different: nothing is stored yet, so dropping one
 * from the list asks nothing.
 *
 * Size and type are checked when the file is picked, using the server's own limits. The
 * server checks again and is the authority; doing it here as well means someone who picks a
 * 40 MB scan learns immediately, rather than after filling in the whole form and saving.
 */

const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

/** Why this file cannot be attached, or null if it can. */
function rejectionReason(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is ${MAX_MB} MB.`;
  }
  if (file.size === 0) {
    return `${file.name} is empty.`;
  }
  // A browser leaves the type blank for some files; the server inspects the actual bytes,
  // so an unknown type is passed through rather than guessed at here.
  if (file.type && !isAllowedMimeType(file.type)) {
    return `${file.name} is not a PNG, JPG, HEIC or PDF.`;
  }
  return null;
}

/** Plus-plan reading for this field (Phase 10). Absent → the field renders exactly as before. */
export type UploadFieldAi = {
  /** Shown in the drop zone: reading starts on its own (Add) or on request (Edit). */
  note: string;
  /** A file's read status by its key (queued `key`, or `doc:{id}`); undefined → show nothing. */
  statusFor: (key: string) => FileReadResult | undefined;
};

/** One file row's AI status, or nothing when that file has no read to report. */
function AiStatus({ status }: { status: FileReadResult | undefined }) {
  if (!status) return null;
  return (
    <span className="flex items-center gap-1.5 text-sm text-accent">
      <SparkleIcon className={cn("w-3.5 h-3.5", status.status === "pending" && "motion-safe:animate-pulse")} />
      {status.status === "pending"
        ? UI.aiFileReading
        : status.status === "found"
          ? UI.aiFileFound(formatMoney(status.amounts.totalCents))
          : UI.noAmountFound}
    </span>
  );
}

export function UploadField({
  label,
  scope,
  queued,
  setQueued,
  attached,
  disabled,
  hidden,
  supportingTypes,
  onRemoveAttached,
  ai,
}: {
  ai?: UploadFieldAi;
  label: string;
  scope: DocumentScope;
  queued: PendingUpload[];
  setQueued: (updater: (current: PendingUpload[]) => PendingUpload[]) => void;
  attached: AttachedDocument[];
  disabled?: boolean;
  hidden?: boolean;
  supportingTypes?: string[];
  onRemoveAttached: (documentId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [supportingType, setSupportingType] = useState(supportingTypes?.[0] ?? "");
  const { open, viewer } = useDocumentViewer();

  /** The queued files belonging to this field — the form holds one list for all scopes. */
  const mine = useMemo(() => queued.filter((item) => item.scope === scope), [queued, scope]);

  // Every blob URL this field has minted, so none outlives the component. Only ever touched
  // from event handlers and effects — never during render.
  const created = useRef(new Set<string>());

  useEffect(() => {
    const outstanding = created.current;
    return () => {
      for (const url of outstanding) URL.revokeObjectURL(url);
      outstanding.clear();
    };
  }, []);

  const releasePreview = (url: string | undefined) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    created.current.delete(url);
  };

  // Minting a blob URL is a side effect, so only ever from a handler — and only for types a
  // browser can actually decode.
  const previewUrlFor = (file: File) => {
    if (!isPreviewableImage(file.type) && !isPdf(file.type)) return undefined;
    const url = URL.createObjectURL(file);
    created.current.add(url);
    return url;
  };

  const attachedDocuments: ViewerDocument[] = attached.map((document) => ({
    src: inlineSrc(document.id),
    filename: document.filename,
    mimeType: document.mimeType,
  }));

  const queuedDocuments: ViewerDocument[] = mine.map((item) => ({
    src: item.previewUrl ?? null,
    filename: item.file.name,
    mimeType: item.file.type,
    // Only a HEIC that failed to convert when picked lands here: ingestion converts it on
    // upload, so there is nothing this browser can decode until then.
    unavailable: item.previewUrl
      ? undefined
      : "This format cannot be shown by the browser. Save the expense and it will preview here — images are converted when they upload.",
  }));

  if (hidden) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold mb-1.5 text-ink">
        {label}
        {ai && <PlusBadge size="sm" />}
      </div>

      {supportingTypes && supportingTypes.length > 0 && (
        <Select
          aria-label="Supporting document type"
          disabled={disabled}
          value={supportingType}
          onValueChange={setSupportingType}
          className="mb-3 max-w-[260px]"
        >
          {supportingTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      )}

      <div
        className={cn(
          "rounded-[3px] p-[18px] text-center",
          ai ? "bg-autofill" : "border border-dashed border-line bg-surface",
        )}
        style={ai ? PLUS_FRAME_STYLE : undefined}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            const accepted = files.filter((file) => {
              const reason = rejectionReason(file);
              if (reason) toast.error(reason);
              return !reason;
            });
            if (accepted.length === 0) return;

            // Every file is queued now, so it is on the form before anything is saved. A HEIC
            // is queued as "preparing" and converted to JPEG here, so it previews before saving;
            // one that won't convert keeps the original, and the server converts it on upload.
            // One photo at a time, so picking ten never holds ten decoded photos in memory.
            const entries: PendingUpload[] = accepted.map((file, index) => {
              const converting = looksLikeHeic(file);
              return {
                key: `${Date.now()}-${index}-${file.name}`,
                scope,
                supportingType: scope === "supporting" ? supportingType : undefined,
                file,
                previewUrl: converting ? undefined : previewUrlFor(file),
                converting: converting || undefined,
              };
            });
            setQueued((current) => [...current, ...entries]);

            void (async () => {
              for (const entry of entries.filter((item) => item.converting)) {
                const file = await heicToJpegFile(entry.file);
                const previewUrl = previewUrlFor(file);
                // A row removed while converting simply isn't found; its unused preview URL is
                // revoked with the rest when the field unmounts.
                setQueued((current) =>
                  current.map((item) =>
                    item.key === entry.key ? { ...item, file, previewUrl, converting: undefined } : item,
                  ),
                );
              }
            })();
          }}
        />
        <Button
          variant="secondary"
          className="min-h-11 px-[18px] text-[15px]"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Add files
        </Button>
        <div className="text-sm text-sub mt-2.5">
          PNG, JPG, HEIC or PDF, up to {MAX_MB} MB. You can attach more than one.
        </div>
        {ai && (
          <div className="flex items-start justify-center gap-1.5 text-sm text-accent font-semibold mt-2 text-left">
            <SparkleIcon className="mt-0.5" />
            <span style={PLUS_GRADIENT_TEXT}>{ai.note}</span>
          </div>
        )}
      </div>

      {(attached.length > 0 || mine.length > 0) && (
        <div className="flex flex-col gap-2.5 mt-3">
          {attached.map((document, position) => (
            <div
              key={document.id}
              className="flex items-center gap-3 border border-line rounded-[3px] px-3 py-2.5 bg-surface"
            >
              <button
                type="button"
                onClick={() => open(attachedDocuments, position)}
                title={`Preview ${document.filename}`}
                className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-[2px] hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <DocumentThumbnail
                  src={thumbnailSrc(document.id, document.mimeType)}
                  pdf={isPdf(document.mimeType)}
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] truncate underline decoration-line underline-offset-2">
                    {document.filename}
                  </span>
                  <span className="block text-sm text-sub">
                    {document.supportingType ? `${document.supportingType} · ` : ""}
                    {document.pageCount && document.pageCount > 1
                      ? `${document.pageCount} pages`
                      : "1 page"}
                  </span>
                  <AiStatus status={ai?.statusFor(`doc:${document.id}`)} />
                </span>
              </button>
              <ConfirmButton
                variant="quiet"
                className="min-h-11"
                disabled={disabled}
                title="Remove this file?"
                confirmLabel="Remove file"
                body={
                  <>
                    <strong>{document.filename}</strong> is deleted from this expense straight
                    away, and Cancel will not bring it back. You would have to upload it again.
                  </>
                }
                onConfirm={() => onRemoveAttached(document.id)}
              >
                Remove
              </ConfirmButton>
            </div>
          ))}

          {mine.map((item, position) => (
            <div
              key={item.key}
              className="flex items-center gap-3 border border-line border-dashed rounded-[3px] px-3 py-2.5 bg-surface"
            >
              <button
                type="button"
                onClick={() => open(queuedDocuments, position)}
                title={`Preview ${item.file.name}`}
                className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-[2px] hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <DocumentThumbnail
                  src={isPreviewableImage(item.file.type) ? (item.previewUrl ?? null) : null}
                  pdf={isPdf(item.file.type)}
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] truncate underline decoration-line underline-offset-2">
                    {item.file.name}
                  </span>
                  {item.converting ? (
                    <span className="block text-sm text-accent motion-safe:animate-pulse" role="status">
                      {UI.convertingPhotos}
                    </span>
                  ) : (
                    <span className="block text-sm text-sub">
                      {item.supportingType ? `${item.supportingType} · ` : ""}Uploads when you save
                    </span>
                  )}
                  <AiStatus status={ai?.statusFor(item.key)} />
                </span>
              </button>
              <Button
                variant="quiet"
                className="min-h-11"
                disabled={disabled}
                onClick={() => {
                  releasePreview(item.previewUrl);
                  setQueued((current) => current.filter((entry) => entry.key !== item.key));
                }}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {viewer}
    </div>
  );
}
