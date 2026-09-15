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
import { Select } from "@/src/components/ui/select";
import {
  isAllowedMimeType,
  MAX_UPLOAD_BYTES,
  type DocumentScope,
} from "@/src/services/storage/keys";

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
}: {
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

  const attachedDocuments: ViewerDocument[] = attached.map((document) => ({
    src: inlineSrc(document.id),
    filename: document.filename,
    mimeType: document.mimeType,
  }));

  const queuedDocuments: ViewerDocument[] = mine.map((item) => ({
    src: item.previewUrl ?? null,
    filename: item.file.name,
    mimeType: item.file.type,
    // A queued HEIC is still HEIC: ingestion converts it to JPEG on upload, so there is
    // nothing this browser can decode until then.
    unavailable: item.previewUrl
      ? undefined
      : "This format cannot be shown by the browser. Save the expense and it will preview here — images are converted when they upload.",
  }));

  if (hidden) return null;

  return (
    <div>
      <div className="block text-[15px] font-semibold mb-1.5 text-ink">{label}</div>

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

      <div className="border border-dashed border-line rounded-[3px] p-[18px] text-center bg-surface">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            const accepted: File[] = [];

            for (const file of files) {
              const reason = rejectionReason(file);
              if (reason) toast.error(reason);
              else accepted.push(file);
            }

            if (accepted.length > 0) {
              setQueued((current) => [
                ...current,
                ...accepted.map((file, index) => {
                  // Created here, in the handler, because minting a blob URL is a side
                  // effect. Only for types a browser can actually decode.
                  const previewUrl =
                    isPreviewableImage(file.type) || isPdf(file.type)
                      ? URL.createObjectURL(file)
                      : undefined;
                  if (previewUrl) created.current.add(previewUrl);

                  return {
                    key: `${Date.now()}-${index}-${file.name}`,
                    scope,
                    supportingType: scope === "supporting" ? supportingType : undefined,
                    file,
                    previewUrl,
                  };
                }),
              ]);
            }
            event.target.value = "";
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
                  <span className="block text-sm text-sub">
                    {item.supportingType ? `${item.supportingType} · ` : ""}Uploads when you save
                  </span>
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
