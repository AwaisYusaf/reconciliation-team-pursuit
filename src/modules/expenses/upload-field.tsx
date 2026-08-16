"use client";

import { useRef, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/src/components/ui/button";
import { Select } from "@/src/components/ui/field";
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
};

/**
 * Multi-file upload field.
 *
 * Files chosen on the add form are queued in the browser and uploaded once the expense
 * exists; in edit mode the expense is already there, so the same queue is flushed on save.
 * Already-attached files are listed with their page counts and can be removed immediately —
 * which the label states plainly, because Cancel will not bring them back.
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

  const mine = queued.filter((item) => item.scope === scope);

  if (hidden) return null;

  return (
    <div>
      <div className="block text-[15px] font-semibold mb-1.5 text-ink">{label}</div>

      {supportingTypes && supportingTypes.length > 0 && (
        <Select
          aria-label="Supporting document type"
          value={supportingType}
          onChange={(event) => setSupportingType(event.target.value)}
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
                ...accepted.map((file, index) => ({
                  key: `${Date.now()}-${index}-${file.name}`,
                  scope,
                  supportingType: scope === "supporting" ? supportingType : undefined,
                  file,
                })),
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
          {attached.map((document) => (
            <div
              key={document.id}
              className="flex items-center gap-3 border border-line rounded-[3px] px-3 py-2.5 bg-surface"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/files/${document.id}?thumb=1`}
                alt=""
                className="w-10 h-10 flex-none object-cover border border-line rounded-[2px] bg-section"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[15px] truncate">{document.filename}</div>
                <div className="text-sm text-sub">
                  {document.supportingType ? `${document.supportingType} · ` : ""}
                  {document.pageCount && document.pageCount > 1
                    ? `${document.pageCount} pages`
                    : "1 page"}
                </div>
              </div>
              <Button
                variant="quiet"
                className="min-h-11"
                disabled={disabled}
                onClick={() => onRemoveAttached(document.id)}
              >
                Remove
              </Button>
            </div>
          ))}

          {mine.map((item) => (
            <div
              key={item.key}
              className="flex items-center gap-3 border border-line border-dashed rounded-[3px] px-3 py-2.5 bg-surface"
            >
              <div className="w-10 h-10 flex-none border border-line rounded-[2px] bg-section" />
              <div className="flex-1 min-w-0">
                <div className="text-[15px] truncate">{item.file.name}</div>
                <div className="text-sm text-sub">
                  {item.supportingType ? `${item.supportingType} · ` : ""}Uploads when you save
                </div>
              </div>
              <Button
                variant="quiet"
                className="min-h-11"
                disabled={disabled}
                onClick={() =>
                  setQueued((current) => current.filter((entry) => entry.key !== item.key))
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {attached.length > 0 && (
        <div className="text-sm text-sub mt-2">
          Removing an attached file takes effect immediately — Cancel will not undo it.
        </div>
      )}
    </div>
  );
}
