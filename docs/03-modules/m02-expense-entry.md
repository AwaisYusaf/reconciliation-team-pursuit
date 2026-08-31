# m02 — Expense Entry (Add / Edit)

## Purpose
The single capture point. One well-designed form used for both add and edit; everything downstream (cover sheets, packet, summary) derives from what's saved here.

## Scope
Routes `/expenses/new`, `/expenses/{id}/edit`. Full field set incl. documents; vendor autofill; live math; no-receipt flow.

## Data
Writes `expenses`, `expense_documents`, upserts `vendor_defaults` (R8.2). Reads `line_items`, `vendor_defaults`. Rules: R1 (money), R2.2 (date/month), R3.7 (projection), R4 (gate), R5.1 (sources), R6.5–R6.7 (notes), R8.1 (autofill).

## Fields
| Field | Notes |
|---|---|
| Name | Free text (payee/label). Type-ahead: substring suggestions max 6; exact match autofills line item + description with `#F3E9DD` flash (still editable). |
| Line item | Select, required. |
| Payment source | Select of the org's active payment-source labels (R5.1), required. |
| Month | Select, defaults to the active month (R2.2); editable in add and edit. Moving months never moves S3 objects (keys are historical). |
| Date | Date input, defaults today in America/Detroit (R2.5), any date allowed. |
| Description / role | Textarea, label: `Description / role — this exact text will print on the cover sheet`. |
| Subtotal / Tax / Fees | Money inputs; negatives allowed (refunds). |
| Include in reimbursement | Tax / Fees checkboxes, shown only when that amount is non-zero; defaults from the payment source (R1.3) |
| Reimbursable box | Live reimbursable per R1.3, with the receipt total beneath it and the shortfall named when they differ (R1.3a) |
| Projection line | `Remaining on {line item} after this expense: {amount}` — red/bold when negative (R3.7). |
| Proof of payment | Multi-file upload (images/PDF), 1–n, thumbnails, remove; required to be documentation-complete. Files count only after server-side process & attach succeeds (R4.6) — failed files show the R12 `upload-failed` chip. |
| Receipt / justification | Multi-file upload (receipt, invoice, or timesheet) — OR checkbox `No receipt available` revealing a required reason textarea (empty → R12 `no-receipt-reason-required`; prints per R6.7). Checking it hides the upload; already-attached receipt files are kept until save, then deleted (confirmation inline) — service rejects the combined state (R4.2). |
| Supporting documents | Repeatable: type select (R11.1) + file; list with remove. |
| Note (inline) | Optional single-line; overrides auto tax note (R6.5). Helper shows the auto note that will print when tax > 0 and note empty. |
| Narrative | Optional textarea (R6.6), helper: "Prints as a paragraph under this expense on the cover sheet." |

## Behavior
- Save validation: name, line item, payment source required — error: `Please enter a name, choose a line item, and choose a payment source.` Amounts default 0. `No receipt available` requires reason.
- Saving without proofs/receipt is **allowed** (capture-first philosophy) — the record is simply documentation-incomplete and shows up in gates (R4.5 pattern). The form shows a passive notice when saving incomplete: "Saved — still missing proof of payment."
- Uploads: presigned POST direct to S3 (server-generated docId keys under the client-generated expense uuid), then `attachDocument(docId)` runs process & attach (R4.6) with progress + per-file status chips. `createExpense` receives the expense uuid + the list of attached docIds — never raw S3 keys. Abandoned drafts are removed by the nightly sweep (>24 h, no expense row).
- Document removals (chips' ×) are immediate and labeled "Removed now — not undone by Cancel"; Cancel discards field edits only.
- After save: to Expenses list, new row highlighted. Edit mode identical, prefilled, plus Delete (confirm dialog). Projection uses the edit-mode formula (R3.7). Editing a month marked Submitted shows the R10.6 warning banner.
- Auto-learn: on save, upsert name → (line item, description) into vendor library.

## Server surface
`createExpense(uuid, fields, docIds)`, `updateExpense`, `deleteExpense`, `presignExpenseUpload` (quota-checked, R13), `attachDocument(docId)`, `deleteExpenseDocument(docId)`, `searchVendorDefaults(q)`.

## Acceptance
Autofill fires on exact match, editable after; projection math matches R3.7 to the cent; no-receipt requires reason; multi-proof upload works (2+ files); edit preserves documents; salary entry (person name + role + 2 proof crops) works identically to vendor entry.

---

## Claude Design prompt

```
Design the ADD EXPENSE screen inside the app chrome (month "March 2026", Add Expense tab
active). Single-column form, max-width 560px, generous spacing.

h1 "Add Expense", subtext "Enter one expense for March 2026. It will appear on the Expenses
list and the matching cover sheet right away."

Fields in order:
1. "Name" text input, value "Quincy Smith", with an open suggestion dropdown under it showing
   matches: "Quincy Smith", "Quajh Zimmerman" (white panel, 1px border, hover row). Add a
   second demo state further down the page… no — keep one field, dropdown open.
2. "Budget line item" select, value "Salary", with a subtle #F3E9DD autofill flash background
   on this and the description field.
3. "Payment source" select, value "Paid by us, reimbursement requested" (other options:
   "Invoiced to fiduciary in advance", "Paid directly by fiduciary").
4. Side-by-side row: "Month" select (value "March 2026") and "Date" date input (value
   03/02/2026).
5. "Description / role — this exact text will print on the cover sheet" textarea, value
   "Director".
6. Row of three money inputs: Subtotal $9,211.50 · Tax $0.00 · Fees $0.00.
7. A bordered emphasis box (2px #211B16 border, white): "Reimbursable amount: $9,211.50" in
   24px bold, under it 15px #5B5147 "Sales tax is excluded. The funder does not reimburse it."
8. One line below: "Remaining on Salary after this expense: $53,839.84" in #5B5147.
9. "Proof of payment" — multi-file upload area (dashed border, "Add files" affordance) with
   two attached file chips shown, each with a small thumbnail, filename
   ("chase-payment-mar-14.png", "chase-payment-mar-28.png") and an × remove.
10. "Receipt / justification (receipt, invoice, or timesheet)" — same multi-file upload with
    one chip "march-timesheet.pdf"; beneath it an unchecked checkbox "No receipt available".
    Also design the checked variant right below as a second demo card: checkbox checked, the
    upload hidden, and a required textarea "Reason (prints on the cover sheet)" filled with
    "Paid via CashApp; payment screenshot attached as proof."
11. "Supporting documents" — a row with a type select (options: Check copy, Request form,
    Vendor invoice, Event flyer, Narrative, Other) + file button; below, one attached row
    "Event flyer — connections-gems-retreat.pdf" with Remove.
12. "Note (optional)" text input, helper "If tax is entered and this is empty, the standard
    tax note prints automatically."
13. "Narrative (optional)" textarea, helper "Prints as a paragraph under this expense on the
    cover sheet."

Bottom: primary "Save expense" button and a quiet "Cancel" link. Also show the validation
error style once: red text "Please enter a name, choose a line item, and choose a payment
source." above the save button.
```
