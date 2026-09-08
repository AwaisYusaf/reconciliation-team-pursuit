"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import toast from "react-hot-toast";

import { Button } from "@/src/components/ui/button";
import { ConfirmButton } from "@/src/components/ui/confirm-button";
import { Select } from "@/src/components/ui/select";
import { Card, CARD_PADDING, SectionTitle } from "@/src/components/ui/surfaces";
import { reportResult } from "@/src/components/ui/toast";
import { removeMonthDocumentAction } from "@/src/modules/packet/actions";
import type { MonthDocumentRow } from "@/src/modules/packet/queries";

/** Fixed categories (R11.2), listed in the order the packet assembles them. */
const CATEGORIES = [
  { value: "bank_statement", label: "Bank statement" },
  { value: "combined_hours", label: "Combined hours" },
  { value: "timesheet", label: "Timesheet" },
  { value: "fiduciary_invoice", label: "Fiduciary invoice" },
  { value: "other", label: "Other" },
] as const;

const LABELS = new Map(CATEGORIES.map((category) => [category.value, category.label]));

const DEFAULT_CATEGORY = "bank_statement";

/**
 * Month-level uploads: the bank statement, timesheets and the fiduciary invoice that belong
 * to the month rather than to any one expense.
 *
 * These are never gated — they are optional supporting material, so a missing bank statement
 * is a reminder rather than a blocker.
 */
export function MonthDocuments({
  month,
  documents,
  monthLabel,
  hasBankStatement,
}: {
  month: string;
  documents: MonthDocumentRow[];
  monthLabel: string;
  hasBankStatement: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY);
  const [fileName, setFileName] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function upload(form: FormData) {
    setUploading(true);
    try {
      const response = await fetch("/api/files/upload", { method: "POST", body: form });
      const result = (await response.json()) as { ok: boolean; error?: string };

      if (!result.ok) {
        toast.error(result.error ?? "That file could not be uploaded.");
        return;
      }
      toast.success("Document added.");
      // `reset()` only clears the DOM-owned fields; the category and displayed filename live
      // in React state.
      formRef.current?.reset();
      setCategory(DEFAULT_CATEGORY);
      setFileName(null);
      router.refresh();
    } catch {
      toast.error("Upload failed — check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  function remove(id: string) {
    startTransition(async () => {
      if (reportResult(await removeMonthDocumentAction(id), "Document removed.")) {
        router.refresh();
      }
    });
  }

  const grouped = CATEGORIES.map((category) => ({
    ...category,
    rows: documents.filter((document) => document.category === category.value),
  })).filter((group) => group.rows.length > 0);

  return (
    <Card className={`${CARD_PADDING} max-w-[720px]`}>
      <SectionTitle className="mb-1">Month documents</SectionTitle>
      <p className="text-sm text-muted mb-4">
        Bank statements, timesheets and the fiduciary invoice for {monthLabel}. These are
        optional and never block a download.
      </p>

      {!hasBankStatement && (
        <p className="text-sm text-danger mb-4">No bank statement attached for {monthLabel} yet.</p>
      )}

      {grouped.length === 0 ? (
        <p className="text-sm text-muted mb-5">Nothing attached yet.</p>
      ) : (
        <div className="flex flex-col gap-4 mb-5">
          {grouped.map((group) => (
            <div key={group.value}>
              <div className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted mb-1.5">
                {group.label}
              </div>
              <ul className="flex flex-col divide-y divide-line border border-line rounded-md">
                {group.rows.map((document) => (
                  <li
                    key={document.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="text-[15px] text-ink">
                      {document.title ? `${document.title} — ` : ""}
                      {document.filename}
                      {document.pageCount ? (
                        <span className="text-muted"> · {document.pageCount} page(s)</span>
                      ) : null}
                    </span>
                    <ConfirmButton
                      variant="quiet"
                      disabled={pending}
                      title="Remove this document?"
                      confirmLabel="Remove document"
                      body={
                        <>
                          <strong>{document.title || document.filename}</strong> is deleted from
                          {" "}
                          {monthLabel} and will no longer appear in the packet. You would have to
                          upload it again.
                        </>
                      }
                      onConfirm={() => remove(document.id)}
                    >
                      Remove
                    </ConfirmButton>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <form
        ref={formRef}
        action={upload}
        className="flex flex-wrap items-end gap-3 border-t border-line pt-4"
      >
        <input type="hidden" name="target" value="month" />
        <input type="hidden" name="month" value={month} />

        <div className="flex flex-col gap-1.5">
          <label id="month-doc-category-label" htmlFor="month-doc-category" className="text-[13px] font-medium text-muted">
            Category
          </label>
          <Select
            id="month-doc-category"
            aria-labelledby="month-doc-category-label"
            name="category"
            required
            value={category}
            onValueChange={setCategory}
            className="min-w-[200px]"
          >
            {CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-muted">Title (optional)</span>
          <input
            name="title"
            type="text"
            maxLength={120}
            placeholder="e.g. Operating account"
            className="border border-line rounded-md px-3 py-2 text-[15px] bg-white"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="month-doc-file" className="text-[13px] font-medium text-muted">
            File
          </label>
          {/* Not wrapped in the label above: the label's implicit click-to-activate would
              double-fire the picker alongside the button's own onClick. */}
          <input
            ref={fileInputRef}
            id="month-doc-file"
            name="file"
            type="file"
            required
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setFileName(file?.name ?? null);
              // Picking a file was the user's confirmation — the separate "Add document"
              // click was a second step people kept getting stuck on. requestSubmit() runs
              // the same `upload` action a real submit would.
              if (file) formRef.current?.requestSubmit();
            }}
          />
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 px-[18px] text-[15px]"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose file
            </Button>
            <span className="text-[15px] text-muted truncate max-w-[220px]">
              {uploading ? "Uploading…" : (fileName ?? "No file chosen")}
            </span>
          </div>
        </div>
      </form>
    </Card>
  );
}

export { LABELS as MONTH_DOCUMENT_LABELS };
