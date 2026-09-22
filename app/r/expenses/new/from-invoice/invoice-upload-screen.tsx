"use client";

/**
 * Add expenses from an invoice (Phase 14 §3, D-115) — two states in one component: pick a
 * file and read it, then check the charges it produced, each one its own real `ExpenseForm`
 * that saves itself, as an expense or a draft, the moment its own button is pressed.
 *
 * Modelled on `app/r/packet/month-documents.tsx` (pick a file, POST it, toast the result) and
 * `src/modules/expenses/expense-form.tsx` (the form this screen embeds one of per charge).
 */
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import toast from "react-hot-toast";

import { Button, buttonClassName } from "@/src/components/ui/button";
import { Dialog } from "@/src/components/ui/dialog";
import { Label } from "@/src/components/ui/field";
import { Select } from "@/src/components/ui/select";
import { DangerPanel, Subtext } from "@/src/components/ui/surfaces";
import { formatDateUS, monthLabel } from "@/src/domain/dates";
import { draftNeeds } from "@/src/domain/draft-rules";
import { formatMoney } from "@/src/domain/format";
import { matchInvoiceLine, type MatchContext, type RecurringMatch, type VendorMatch } from "@/src/domain/invoice-match";
import { UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { checkDuplicateInvoiceAction } from "@/src/modules/expense-imports/import-actions";
import { toMatchLine, type WireInvoiceLine } from "@/src/modules/expense-imports/invoice-line";
import type { ExpenseInput } from "@/src/modules/expenses/actions";
import { ExpenseForm, type FormOptions, type RemainingByLineItem } from "@/src/modules/expenses/expense-form";
import { moneyField } from "@/src/modules/expenses/vendor-fill";
import { cn } from "@/src/lib/cn";
import { MAX_UPLOAD_BYTES } from "@/src/services/storage/keys";

type ReadInvoiceData = {
  vendor: string | null;
  invoiceDate: string | null;
  billTaxCents: number | null;
  billFeesCents: number | null;
  lines: WireInvoiceLine[];
};

/**
 * The open/closed marker on each charge.
 *
 * An inline SVG rotated with a transition, like the rest of this app's icons, rather than the
 * text triangles this replaced: those render at a different weight and baseline in every font
 * and could not be animated, so a folded card looked like a typo rather than a control.
 */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={cn(
        "w-4 h-4 flex-none mt-1 text-sub transition-transform duration-150",
        open && "rotate-90",
      )}
    >
      <path
        d="M7.5 4.5 13 10l-5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** One charge's read-only prefill — fed into its `ExpenseForm` as `embedded.initialValues` and
 *  into the closed-card summary line. Immutable once built: the form owns the live, editable
 *  copy from here on (Phase 14 §3 card save flow). */
type ChargePrefill = {
  name: string;
  lineItemId: string;
  paymentSource: string;
  description: string;
  narrative: string;
  note: string;
  subtotal: string;
  tax: string;
  fees: string;
  date: string;
};

type ChargeCard = {
  /** Stable across removes, unlike an array index — the double-save guard and the saved-state
   *  map are both keyed on this. */
  id: string;
  open: boolean;
  /**
   * What this charge will become when Done is pressed, or null while nobody has said.
   *
   * Marking writes NOTHING: the records are created once, by Done, so a half-finished invoice
   * leaves nothing behind. The card stays open-able and can be marked again, which is why the
   * form underneath is kept mounted rather than swapped for the badge.
   */
  saved: "expense" | "draft" | null;
  /** The values the form held when it was last marked. Done sends these; an unmarked card
   *  sends what the reader prefilled. */
  marked: ExpenseInput | null;
  /** Proof and supporting files the person queued on this card, each with the scope it was
   *  picked under. They cannot be uploaded until the expense exists, so they travel with the
   *  Done request and the server attaches them under that same scope. */
  files: Array<{ scope: string; file: File }>;
  initial: ChargePrefill;
};

type CheckState = {
  file: File;
  invoiceDate: string | null;
  vendor: string | null;
  billTaxCents: number | null;
  billFeesCents: number | null;
  truncated: boolean;
  duplicate: { date: string; by: string | null } | null;
  rows: ChargeCard[];
};

function cardFromLine(line: WireInvoiceLine, ctx: MatchContext): ChargeCard {
  const draft = matchInvoiceLine(toMatchLine(line), ctx);
  return {
    id: crypto.randomUUID(),
    open: false,
    saved: null,
    marked: null,
    files: [],
    initial: {
      name: draft.name,
      lineItemId: draft.lineItemId ?? "",
      paymentSource: draft.paymentSource,
      description: draft.description,
      narrative: draft.narrative ?? "",
      note: "",
      subtotal: moneyField(draft.subtotalCents),
      tax: moneyField(draft.taxCents),
      fees: moneyField(draft.feesCents),
      date: draft.date,
    },
  };
}

/** Hex-encode a file's SHA-256, for the non-blocking duplicate warning only — the server
 *  recomputes the hash it actually stores from, so this is never the source of truth. */
async function sha256Hex(file: File): Promise<string | null> {
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    // crypto.subtle is undefined on an insecure origin — the warning is a courtesy, so it is
    // simply skipped rather than surfaced as an error.
    return null;
  }
}

export function InvoiceExtract({
  activeSources,
  headerSelectedSourceId,
  options,
  remaining,
  matchContext,
  lockedMonths,
  activeMonth,
  today,
  children,
  enabled,
}: {
  activeSources: Array<{ id: string; name: string }>;
  headerSelectedSourceId: string | null;
  options: FormOptions;
  /** Remaining budget per line item, for the live projection each card's own form shows
   *  (R3.7) — the same figures `new/page.tsx` already computes for the plain Add Expense form. */
  remaining: RemainingByLineItem;
  matchContext: { recurringItems: RecurringMatch[]; vendors: VendorMatch[] };
  lockedMonths: string[];
  activeMonth: string;
  today: string;
  /** The ordinary Add Expense screen. Shown until an invoice has been read, then replaced by
   *  the extracted charges: one screen, so pressing the button never loses the form. */
  children: ReactNode;
  /** False for an organization without the Plus plan or with the switch off (D-105). The
   *  button simply is not there, and this component renders the form and nothing else. */
  enabled: boolean;
}) {
  const router = useRouter();

  const headerSourceIsActive =
    headerSelectedSourceId !== null && activeSources.some((source) => source.id === headerSelectedSourceId);
  const askForSource = !headerSourceIsActive;

  const [fundingSourceId, setFundingSourceId] = useState(
    headerSourceIsActive ? headerSelectedSourceId! : activeSources[0]?.id ?? "",
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [reading, setReading] = useState(false);
  const [check, setCheck] = useState<CheckState | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ChargeCard | null>(null);
  const [confirmLeaveUnsaved, setConfirmLeaveUnsaved] = useState(false);
  const [pending, startTransition] = useTransition();
  /** Synchronous double-submit guard on Done. `useTransition`'s `pending` only turns true on
   *  the next render, which leaves a window for two fast presses to both get through and
   *  import the same invoice twice; a ref flips before anything is awaited. */
  const submittingRef = useRef(false);

  const lockedMonthKeys = new Set(lockedMonths);
  const monthLockedForSelected = lockedMonthKeys.has(`${fundingSourceId}:${activeMonth}`);

  /** Takes the file it was given rather than reading state: `setFile` would not have applied
   *  yet on the same tick the picker fires, and the read must start immediately. */
  async function readInvoice(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("That file is larger than 25 MB.");
      return;
    }
    if (monthLockedForSelected) {
      toast.error(UI.monthLocked(monthLabel(activeMonth)));
      return;
    }

    setReading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/files/read-invoice", { method: "POST", body: form });
      const json = (await response.json()) as {
        ok: boolean;
        error?: string;
        data?: {
          found: boolean;
          error?: string;
          invoice?: ReadInvoiceData;
          truncated?: boolean;
        };
      };

      if (!response.ok || !json.ok) {
        toast.error(json.error ?? "That document could not be read.");
        return;
      }
      const data = json.data;
      if (!data || !data.found || !data.invoice) {
        toast.error(data?.error ?? UI.readInvoiceNothingFound);
        return;
      }

      const invoice = data.invoice;
      const ctx: MatchContext = {
        recurringItems: matchContext.recurringItems,
        vendors: matchContext.vendors,
        activePaymentSources: options.paymentSources,
        sourceLineItemIds: (options.lineItemsBySource[fundingSourceId] ?? []).map((item) => item.id),
        invoiceDate: invoice.invoiceDate ?? today,
        month: activeMonth,
      };

      const sha256 = await sha256Hex(file);
      let duplicate: { date: string; by: string | null } | null = null;
      if (sha256) {
        const result = await checkDuplicateInvoiceAction(fundingSourceId, sha256);
        if (result.ok && result.data) duplicate = result.data;
      }

      // A fresh read starts a fresh import — nothing carried over from a previous file.

      setCheck({
        file,
        invoiceDate: invoice.invoiceDate,
        vendor: invoice.vendor,
        billTaxCents: invoice.billTaxCents,
        billFeesCents: invoice.billFeesCents,
        truncated: Boolean(data.truncated),
        duplicate,
        rows: invoice.lines.map((line) => cardFromLine(line, ctx)),
      });
    } catch {
      toast.error("That document could not be read. Try again.");
    } finally {
      setReading(false);
    }
  }

  function toggleOpen(cardId: string) {
    setCheck((current) =>
      current
        ? { ...current, rows: current.rows.map((row) => (row.id === cardId ? { ...row, open: !row.open } : row)) }
        : current,
    );
  }

  function markSaved(cardId: string, kind: "expense" | "draft", values: ExpenseInput) {
    setCheck((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.id === cardId ? { ...row, saved: kind, marked: values, open: false } : row,
            ),
          }
        : current,
    );
  }

  /** Mirrors a card's queued proof and supporting files up here, so Done can send them. */
  function setCardFiles(cardId: string, files: Array<{ scope: string; file: File }>) {
    setCheck((current) =>
      current
        ? { ...current, rows: current.rows.map((row) => (row.id === cardId ? { ...row, files } : row)) }
        : current,
    );
  }

  function removeCard(cardId: string) {
    setCheck((current) => (current ? { ...current, rows: current.rows.filter((row) => row.id !== cardId) } : current));
  }

  /**
   * Drop a charge from the screen. Removing an unsaved one is the only way to leave it out of
   * the import; removing a saved one only takes it off this list — the expense or draft it
   * already wrote stays exactly as saved, so a saved card gets a confirmation that says so.
   */
  function requestRemove(card: ChargeCard) {
    if (card.saved === null) {
      removeCard(card.id);
      return;
    }
    setConfirmRemove(card);
  }

  /**
   * One card's Save or Mark as draft. Writes NOTHING.
   *
   * Marking only records what this charge will become and the values it holds; Done is the
   * single moment anything reaches the database, so abandoning a half-checked invoice leaves
   * no records and no stored file behind. A marked card can be reopened and marked again,
   * which is why nothing here is guarded against being pressed twice: pressing twice just
   * records the same intent twice.
   */
  function saveCard(cardId: string, kind: "expense" | "draft", input: ExpenseInput): Promise<ActionResult<{ id: string }>> {
    if (kind === "expense") {
      // The full rules, checked here so the person sees which field is missing while looking
      // at the card. The server checks the same thing again when Done posts it, and that is
      // the guarantee: this is only what makes it quick to fix.
      const needs = draftNeeds({
        name: input.name,
        lineItemId: input.lineItemId || null,
        paymentSource: input.paymentSource,
        date: input.date,
        narrative: input.narrative,
      });
      if (needs.length > 0) {
        return Promise.resolve(fail(`${needs.join(" · ")} ${UI.invoiceOrMarkAsDraft}`));
      }
    }

    markSaved(cardId, kind, input);
    return Promise.resolve(ok({ id: cardId }));
  }

  /**
   * The one moment anything is written.
   *
   * Every charge still on the screen is created: the ones marked as expenses become real
   * expenses, everything else becomes a draft. One request, one transaction on the server, so
   * an invoice is never half imported. Each card's queued proof and supporting files travel
   * with it and the server attaches them, because there is no expense to upload them to until
   * this request has created one.
   */
  function handleDone() {
    if (!check) return;
    if (submittingRef.current) return;

    const cards = check.rows;
    if (cards.length === 0) {
      toast.error(UI.invoiceNoCharges);
      return;
    }

    // The full rules again for anything marked as an expense, so a card edited after it was
    // marked cannot slip through. The server refuses the same case; this only points at which.
    for (const card of cards) {
      if (card.saved !== "expense") continue;
      const values = card.marked ?? card.initial;
      const needs = draftNeeds({
        name: values.name,
        lineItemId: values.lineItemId || null,
        paymentSource: values.paymentSource,
        date: values.date,
        narrative: values.narrative,
      });
      if (needs.length > 0) {
        toast.error(`${values.name.trim() || "A charge"}: ${needs.join(" · ")} ${UI.invoiceOrMarkAsDraft}`);
        return;
      }
    }

    submittingRef.current = true;
    startTransition(async () => {
      const form = new FormData();
      form.set("file", check.file);
      form.set("fundingSourceId", fundingSourceId);
      if (check.vendor) form.set("vendorName", check.vendor);
      if (check.invoiceDate) form.set("invoiceDate", check.invoiceDate);
      if (check.billTaxCents !== null) form.set("billTaxCents", String(check.billTaxCents));
      if (check.billFeesCents !== null) form.set("billFeesCents", String(check.billFeesCents));

      form.set(
        "rows",
        JSON.stringify(
          cards.map((card) => {
            const values = card.marked ?? card.initial;
            return {
              name: values.name,
              lineItemId: values.lineItemId,
              paymentSource: values.paymentSource,
              description: values.description,
              narrative: values.narrative,
              note: values.note,
              subtotal: values.subtotal,
              tax: values.tax,
              fees: values.fees,
              date: values.date,
              // An unmarked charge becomes a draft: a draft counts in nothing until someone
              // approves it, so it is the safe way to be wrong about a charge.
              kind: card.saved === "expense" ? "expense" : "draft",
            };
          }),
        ),
      );

      // Keyed by row index, so the server can attach each card's files to the record that
      // card became.
      cards.forEach((card, index) => {
        for (const { scope, file } of card.files) form.append(`rowFiles-${index}-${scope}`, file);
      });

      try {
        const response = await fetch("/api/expenses/from-invoice", { method: "POST", body: form });
        const json = (await response.json()) as { ok: boolean; error?: string };
        if (!json.ok) {
          submittingRef.current = false;
          toast.error(json.error ?? "Those charges could not be saved.");
          return;
        }
        const expenseCount = cards.filter((card) => card.saved === "expense").length;
        toast.success(UI.invoiceDoneResult(expenseCount, cards.length - expenseCount));
        router.push("/r/expenses");
        router.refresh();
      } catch {
        submittingRef.current = false;
        toast.error("Those charges could not be saved. Try again.");
      }
    });
  }

  // Nothing to offer without the plan and the switch, so the screen is exactly what it was
  // before this feature existed.
  if (!enabled) return <>{children}</>;

  if (!check) {
    return (
      <>
        {/* The whole Add Expense screen, with one extra control in its header. Pressing it
            opens the file picker straight away and the read starts on the file chosen, so
            there is no upload page in between and no way to arrive at one with nothing
            picked. The form underneath is untouched until an invoice actually reads. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-[260px]">{children}</div>
          <div className="flex flex-col items-end gap-2.5">
            {/* Only when the header is on All sources: an invoice has to land on one source,
                and with a single button there is no later moment to ask. */}
            {askForSource && (
              <div className="min-w-[220px]">
                <Label id="invoiceSource-label" htmlFor="invoiceSource">
                  Funding source
                </Label>
                <Select
                  id="invoiceSource"
                  aria-labelledby="invoiceSource-label"
                  value={fundingSourceId}
                  onValueChange={setFundingSourceId}
                >
                  {activeSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <input
              ref={fileInputRef}
              id="invoiceFile"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
              disabled={reading}
              className="sr-only"
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                // Cleared straight away so picking the same file twice still fires `change`,
                // otherwise a failed read could not be retried with the same invoice.
                event.target.value = "";
                if (chosen) void readInvoice(chosen);
              }}
            />
            <Button
              variant="secondary"
              data-tour="add-expense-from-invoice"
              onClick={() => fileInputRef.current?.click()}
              disabled={reading || monthLockedForSelected}
            >
              {reading ? UI.invoiceReadingButton : UI.invoiceExtractFromInvoice}
            </Button>
            {monthLockedForSelected && (
              <Subtext className="max-w-[260px] text-right">
                {UI.monthLocked(monthLabel(activeMonth))}
              </Subtext>
            )}
          </div>
        </div>
      </>
    );
  }

  const wholeBillCents = (check.billTaxCents ?? 0) + (check.billFeesCents ?? 0);
  const showWholeBillCharge =
    (check.billTaxCents !== null && check.billTaxCents !== 0) ||
    (check.billFeesCents !== null && check.billFeesCents !== 0);
  const unsavedCount = check.rows.filter((row) => row.saved === null).length;

  return (
    <div className="max-w-[720px]">
      {check.invoiceDate && <Subtext className="mb-4">Invoice date: {formatDateUS(check.invoiceDate)}</Subtext>}

      {check.duplicate && (
        <DangerPanel tone="notice" className="mb-4">
          {UI.invoiceAlreadyAdded(check.duplicate.date, check.duplicate.by)}
        </DangerPanel>
      )}

      {check.truncated && (
        <DangerPanel tone="notice" className="mb-4">
          {UI.readInvoiceTooManyLines}
        </DangerPanel>
      )}

      {showWholeBillCharge && (
        <DangerPanel tone="notice" className="mb-4">
          {UI.invoiceWholeBillCharge(formatMoney(wholeBillCents))}
        </DangerPanel>
      )}

      <div className="flex flex-col gap-4 mb-6">
        {check.rows.map((card) => {
          const needs = draftNeeds({
            name: card.initial.name,
            lineItemId: card.initial.lineItemId || null,
            paymentSource: card.initial.paymentSource,
            date: card.initial.date,
            narrative: card.initial.narrative,
          });
          return (
            <div
              key={card.id}
              className="border border-line rounded-[3px] bg-surface overflow-hidden"
            >
              {/* The whole summary line is the toggle on an unsaved card, so there is a large
                  target on a phone rather than a small chevron. A marked card is still a
                  button: nothing has been written yet, so it must be openable and markable
                  again. */}
              <div className="flex items-start gap-3 px-4 py-3.5">
                  <button
                    type="button"
                    onClick={() => toggleOpen(card.id)}
                    aria-expanded={card.open}
                    aria-controls={`charge-${card.id}-fields`}
                    className="flex-1 flex items-start gap-2.5 text-left min-h-11 cursor-pointer"
                  >
                    <Chevron open={card.open} />
                    <span className="flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <span className="font-semibold">{card.initial.name.trim() || "Untitled charge"}</span>
                        <span className="text-sub">{card.initial.subtotal ? `$${card.initial.subtotal}` : ""}</span>
                        {/* Marked, not written: Done is what creates it. The card stays a
                            button so it can be opened, changed and marked again. */}
                        {card.saved !== null && (
                          <span
                            className={cn(
                              "text-[12px] font-semibold rounded-full px-2 py-0.5",
                              card.saved === "expense" ? "bg-accent text-surface" : "bg-line text-ink",
                            )}
                          >
                            {card.saved === "expense" ? "Saving as expense" : "Saving as draft"}
                          </span>
                        )}
                      </span>
                      {/* Closed cards have to say what is still wrong with them, or a folded
                          charge could look finished when it is not (this is only ever the
                          invoice's own read — anything typed since is inside the form below). */}
                      {!card.open && needs.length > 0 && card.saved === null && (
                        <span className="block text-[13px] text-sub mt-0.5">{needs.join(" · ")}</span>
                      )}
                    </span>
                  </button>
                <button
                  type="button"
                  onClick={() => requestRemove(card)}
                  className={buttonClassName("quiet", "min-h-11 px-3 text-[14px] flex-none")}
                >
                  Remove
                </button>
              </div>

              <div
                id={`charge-${card.id}-fields`}
                className={card.open ? "border-t border-line px-4 py-4" : "hidden"}
              >
                  <ExpenseForm
                    invoiceReceipt={{ filename: check.file.name, file: check.file }}
                    options={options}
                    remaining={remaining}
                    lockedMonths={lockedMonths}
                    today={today}
                    activeMonth={activeMonth}
                    initialFundingSourceId={fundingSourceId}
                    headerSelectedSourceId={headerSelectedSourceId}
                    readAmounts={enabled}
                    embedded={{
                      initialValues: {
                        ...card.initial,
                        fundingSourceId,
                        month: activeMonth,
                      },
                      save: {
                        label: "Save as expense",
                        action: (input) => saveCard(card.id, "expense", input),
                      },
                      draft: {
                        label: "Mark as draft",
                        action: async (input) => {
                          const result = await saveCard(card.id, "draft", input);
                          return result.ok ? ok() : fail(result.error);
                        },
                      },
                      // `saveCard` has already recorded the mark and closed the card, since
                      // it is the one that holds the values. Nothing left to do here.
                      onSaved: () => {},
                      onQueuedChange: (files) => setCardFiles(card.id, files),
                    }}
                  />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <Button onClick={handleDone} disabled={pending}>
          {pending ? UI.invoiceDoneSaving : UI.invoiceDone}
        </Button>
        <Button
          variant="quiet"
          disabled={pending}
          // Back throws away the whole read — every card, every narrative typed and every file
          // queued — so it asks first whenever there is anything to lose. Nothing has been
          // written at this point: the charges only reach the database when Done is pressed.
          onClick={() => (unsavedCount > 0 ? setConfirmLeaveUnsaved(true) : setCheck(null))}
        >
          Back
        </Button>
      </div>

      <Dialog
        open={confirmRemove !== null}
        title="Remove this charge from the screen?"
        dismissLabel="Keep it"
        onDismiss={() => setConfirmRemove(null)}
        confirm={{
          label: "Remove",
          onConfirm: () => {
            if (confirmRemove) removeCard(confirmRemove.id);
            setConfirmRemove(null);
          },
        }}
      >
        {confirmRemove &&
          `It only removes this card from the screen. The ${confirmRemove.saved === "expense" ? "expense" : "draft"} it already saved stays exactly as saved.`}
      </Dialog>

      <Dialog
        open={confirmLeaveUnsaved}
        title="Leave without saving every charge?"
        dismissLabel="Keep editing"
        onDismiss={() => setConfirmLeaveUnsaved(false)}
        confirm={{
          label: "Discard them",
          onConfirm: () => {
            setConfirmLeaveUnsaved(false);
            setCheck(null);
          },
        }}
      >
        {`${unsavedCount} ${unsavedCount === 1 ? "charge has" : "charges have"} not been marked yet. Going back reads nothing into the month, and the invoice would have to be read again.`}
      </Dialog>
    </div>
  );
}
