"use client";

/**
 * Add expenses from an invoice (Phase 14 §3, D-115) — two states in one component: pick a
 * file and read it, then check the drafts it produced before creating them.
 *
 * Modelled on `app/r/packet/month-documents.tsx` (pick a file, POST it, toast the result) and
 * `src/modules/expenses/expense-form.tsx` (the field set, MoneyInput, Select). Nothing new is
 * invented here — every primitive comes from `src/components/ui/*` and `field.tsx`.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import toast from "react-hot-toast";

import { Button, buttonClassName } from "@/src/components/ui/button";
import { Helper, Input, Label, MoneyInput, Textarea } from "@/src/components/ui/field";
import { Select } from "@/src/components/ui/select";
import { Card, CARD_PADDING, DangerPanel, Subtext } from "@/src/components/ui/surfaces";
import { formatDateUS, monthLabel } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { centsToDollars } from "@/src/domain/money";
import { matchInvoiceLine, type MatchContext, type RecurringMatch, type VendorMatch } from "@/src/domain/invoice-match";
import { UI } from "@/src/domain/strings";
import { checkDuplicateInvoiceAction } from "@/src/modules/expense-imports/import-actions";
import { toMatchLine, type WireInvoiceLine } from "@/src/modules/expense-imports/invoice-line";
import { moneyField } from "@/src/modules/expenses/vendor-fill";
import { MAX_UPLOAD_BYTES } from "@/src/services/storage/keys";

type ReadInvoiceData = {
  vendor: string | null;
  invoiceDate: string | null;
  billTaxCents: number | null;
  billFeesCents: number | null;
  lines: WireInvoiceLine[];
};

type RowState = {
  ticked: boolean;
  name: string;
  lineItemId: string;
  paymentSource: string;
  description: string;
  narrative: string;
  subtotal: string;
  tax: string;
  fees: string;
  date: string;
};

/** The parts of `loadExpenseFormOptions`'s result this screen actually uses — `FormOptions`
 *  (expense-form.tsx) also requires `months`, which nothing here needs. */
type InvoiceFormOptions = {
  lineItemsBySource: Record<string, Array<{ id: string; name: string }>>;
  paymentSources: string[];
};

type CheckState = {
  file: File;
  invoiceDate: string | null;
  vendor: string | null;
  billTaxCents: number | null;
  billFeesCents: number | null;
  truncated: boolean;
  duplicate: { date: string; by: string | null } | null;
  rows: RowState[];
};

function rowFromDraft(line: WireInvoiceLine, ctx: MatchContext): RowState {
  const draft = matchInvoiceLine(toMatchLine(line), ctx);
  return {
    ticked: true,
    name: draft.name,
    lineItemId: draft.lineItemId ?? "",
    paymentSource: draft.paymentSource,
    description: draft.description,
    narrative: draft.narrative ?? "",
    subtotal: moneyField(draft.subtotalCents),
    tax: moneyField(draft.taxCents),
    fees: moneyField(draft.feesCents),
    date: draft.date,
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

export function InvoiceUploadScreen({
  activeSources,
  headerSelectedSourceId,
  options,
  matchContext,
  lockedMonths,
  activeMonth,
  today,
}: {
  activeSources: Array<{ id: string; name: string }>;
  headerSelectedSourceId: string | null;
  options: InvoiceFormOptions;
  matchContext: { recurringItems: RecurringMatch[]; vendors: VendorMatch[] };
  lockedMonths: string[];
  activeMonth: string;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const headerSourceIsActive =
    headerSelectedSourceId !== null && activeSources.some((source) => source.id === headerSelectedSourceId);
  const askForSource = !headerSourceIsActive;

  const [fundingSourceId, setFundingSourceId] = useState(
    headerSourceIsActive ? headerSelectedSourceId! : activeSources[0]?.id ?? "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [check, setCheck] = useState<CheckState | null>(null);

  const lockedMonthKeys = new Set(lockedMonths);
  const monthLockedForSelected = lockedMonthKeys.has(`${fundingSourceId}:${activeMonth}`);

  async function readInvoice() {
    if (!file) {
      toast.error("Choose a file.");
      return;
    }
    if (file.type !== "application/pdf") {
      toast.error(UI.invoicePdfOnly);
      return;
    }
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

      setCheck({
        file,
        invoiceDate: invoice.invoiceDate,
        vendor: invoice.vendor,
        billTaxCents: invoice.billTaxCents,
        billFeesCents: invoice.billFeesCents,
        truncated: Boolean(data.truncated),
        duplicate,
        rows: invoice.lines.map((line) => rowFromDraft(line, ctx)),
      });
    } catch {
      toast.error("That document could not be read. Try again.");
    } finally {
      setReading(false);
    }
  }

  function setRow(index: number, patch: Partial<RowState>) {
    setCheck((current) => {
      if (!current) return current;
      const rows = current.rows.slice();
      rows[index] = { ...rows[index], ...patch };
      return { ...current, rows };
    });
  }

  function setRowMoney(index: number, field: "subtotal" | "tax" | "fees", value: string) {
    if (field === "subtotal") setRow(index, { subtotal: value });
    else if (field === "tax") setRow(index, { tax: value });
    else setRow(index, { fees: value });
  }

  function createDrafts() {
    if (!check) return;
    const ticked = check.rows.filter((row) => row.ticked);
    if (ticked.length === 0) {
      toast.error(UI.invoiceNoRowsTicked);
      return;
    }

    startTransition(async () => {
      const form = new FormData();
      form.set("file", check.file);
      form.set("fundingSourceId", fundingSourceId);
      form.set(
        "rows",
        JSON.stringify(
          ticked.map((row) => ({
            name: row.name,
            lineItemId: row.lineItemId,
            paymentSource: row.paymentSource,
            description: row.description,
            narrative: row.narrative,
            subtotal: row.subtotal,
            tax: row.tax,
            fees: row.fees,
            date: row.date,
          })),
        ),
      );
      if (check.vendor) form.set("vendorName", check.vendor);
      if (check.invoiceDate) form.set("invoiceDate", check.invoiceDate);
      if (check.billTaxCents !== null) form.set("billTaxCents", centsToDollars(check.billTaxCents).toFixed(2));
      if (check.billFeesCents !== null) form.set("billFeesCents", centsToDollars(check.billFeesCents).toFixed(2));

      try {
        const response = await fetch("/api/expenses/from-invoice", { method: "POST", body: form });
        const json = (await response.json()) as { ok: boolean; error?: string };
        if (!json.ok) {
          toast.error(json.error ?? "Those drafts could not be created.");
          return;
        }
        toast.success("Drafts created.");
        router.push("/r/expenses");
        router.refresh();
      } catch {
        toast.error("Those drafts could not be created. Try again.");
      }
    });
  }

  if (!check) {
    return (
      <div className="max-w-[560px]">
        <Subtext className="mb-[30px]">{UI.invoiceUploadIntro}</Subtext>
        <Card className={`${CARD_PADDING} flex flex-col gap-[22px]`}>
          {askForSource && (
            <div>
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

          <div>
            <Label htmlFor="invoiceFile">Invoice PDF</Label>
            <input
              id="invoiceFile"
              type="file"
              accept="application/pdf"
              disabled={reading}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-[15px]"
            />
          </div>

          {monthLockedForSelected && <DangerPanel>{UI.monthLocked(monthLabel(activeMonth))}</DangerPanel>}

          <div className="flex flex-wrap items-center gap-5">
            <Button onClick={readInvoice} disabled={reading}>
              {reading ? UI.invoiceReadingButton : UI.invoiceReadButton}
            </Button>
            <Link href="/r/expenses/new" className={buttonClassName("quiet")}>
              Cancel
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const wholeBillCents = (check.billTaxCents ?? 0) + (check.billFeesCents ?? 0);
  const showWholeBillCharge =
    (check.billTaxCents !== null && check.billTaxCents !== 0) ||
    (check.billFeesCents !== null && check.billFeesCents !== 0);

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
        {check.rows.map((row, index) => {
          const sourceLineItems = options.lineItemsBySource[fundingSourceId] ?? [];
          return (
            <Card key={index} className={`${CARD_PADDING} flex flex-col gap-3.5`}>
              <label className="flex items-center gap-2.5 text-base cursor-pointer min-h-11">
                <input
                  type="checkbox"
                  checked={row.ticked}
                  onChange={(event) => setRow(index, { ticked: event.target.checked })}
                  className="w-5 h-5 accent-accent"
                />
                <span className="font-semibold">Charge {index + 1}</span>
              </label>

              <div>
                <Label htmlFor={`name-${index}`}>Name</Label>
                <Input
                  id={`name-${index}`}
                  value={row.name}
                  onChange={(event) => setRow(index, { name: event.target.value })}
                />
              </div>

              <div className="flex flex-wrap gap-3.5">
                <div className="flex-1 min-w-[220px]">
                  <Label id={`lineItem-${index}-label`} htmlFor={`lineItem-${index}`}>
                    Line item
                  </Label>
                  <Select
                    id={`lineItem-${index}`}
                    aria-labelledby={`lineItem-${index}-label`}
                    value={row.lineItemId}
                    onValueChange={(value) => setRow(index, { lineItemId: value })}
                  >
                    <option value="">{UI.draftNeedsLineItem}</option>
                    {sourceLineItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex-1 min-w-[220px]">
                  <Label id={`paymentSource-${index}-label`} htmlFor={`paymentSource-${index}`}>
                    Payment source
                  </Label>
                  <Select
                    id={`paymentSource-${index}`}
                    aria-labelledby={`paymentSource-${index}-label`}
                    value={row.paymentSource}
                    onValueChange={(value) => setRow(index, { paymentSource: value })}
                  >
                    <option value="">Choose a payment source</option>
                    {options.paymentSources.map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor={`description-${index}`}>Description</Label>
                <Textarea
                  id={`description-${index}`}
                  rows={2}
                  value={row.description}
                  onChange={(event) => setRow(index, { description: event.target.value })}
                />
              </div>

              <div>
                <Label htmlFor={`narrative-${index}`}>Narrative</Label>
                <Textarea
                  id={`narrative-${index}`}
                  rows={2}
                  value={row.narrative}
                  onChange={(event) => setRow(index, { narrative: event.target.value })}
                />
              </div>

              <div className="flex flex-wrap gap-3.5">
                {(["subtotal", "tax", "fees"] as const).map((field) => (
                  <div key={field} className="flex-1 min-w-[150px]">
                    <Label htmlFor={`${field}-${index}`} className="capitalize">
                      {field}
                    </Label>
                    <MoneyInput
                      id={`${field}-${index}`}
                      value={row[field]}
                      placeholder="0.00"
                      onChange={(event) => setRowMoney(index, field, event.target.value)}
                    />
                  </div>
                ))}
              </div>
              {!row.lineItemId && <Helper>{UI.draftNeedsLineItem}</Helper>}
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <Button onClick={createDrafts} disabled={pending}>
          {UI.invoiceCreateDrafts}
        </Button>
        <Button variant="quiet" disabled={pending} onClick={() => setCheck(null)}>
          Back
        </Button>
      </div>
    </div>
  );
}
