# m02 — Expense Entry (Add / Edit)

## Purpose
The single capture point. One well-designed form used for both add and edit; everything downstream (cover sheets, packet, summary) derives from what's saved here.

## Scope
Routes `/r/expenses/new`, `/r/expenses/{id}/edit`. Full field set incl. documents; vendor autofill; live math; no-receipt flow.

## Data
Writes `expenses`, `expense_documents`, upserts `vendor_defaults` (R8.2). Reads `funding_sources`, `line_items`, `vendor_defaults`. Rules: R1 (money), R1.3 (reimbursement rules — funding source, D-93), R2.2 (date/month), R2.6 (reference, per source per month, D-93), R3.7 (projection), R4 (gate), R5.1 (payment sources — how paid only, D-93), R6.5–R6.7 (notes), R8.1 (autofill), §14 (funding sources).

## Fields
| Field | Notes |
|---|---|
| Funding source | Select, above Line item (Phase 6/D-93). Pre-filled and **not editable** when the org has only one source (spec §2/§4) — rendered as static text, no control. Changing it clears Line item and re-applies the new source's tax/fee rules. |
| Name | Free text (payee/label). Type-ahead: substring suggestions max 6; exact match autofills line item + description with `#F3E9DD` flash (still editable) — the remembered line item only applies if it belongs to the currently selected funding source, otherwise the field is left empty (D-93). |
| Line item | Select, required. Lists only the selected funding source's line items, each labelled `"{name} · {amount} remaining"` (D-93, Appendix A §4). |
| Payment source | Select of the org's active payment-source labels (R5.1), required. As of D-93 this only records *how* something was paid — it no longer drives the reimbursement flags. |
| Reporting month | Select labelled `Reporting month`, defaults to the active month (R2.2); editable in add and edit. Helper: `The month whose packet this expense goes in. It can differ from the date.` (usability #28). Not shown on an invoice card, where the invoice fixes the month. Moving months never moves S3 objects (keys are historical). |
| Date | Date input, defaults today in America/Detroit (R2.5), any date allowed. |
| Description / role | Textarea, label `Description / role`, helper: `Prints in the cover sheet table next to the name, exactly as typed. For a salary, the person's role.` (usability #26). |
| Subtotal / Tax / Fees | Money inputs; negatives allowed (refunds). Each input carries the per-form id its label points at, so each is programmatically labelled (usability #29). |
| Include in reimbursement | Tax / Fees checkboxes, shown only when that amount is non-zero; defaults from the selected **funding source** (R1.3, D-93 — no longer the payment source) |
| Reimbursable box | Live reimbursable per R1.3, with the receipt total beneath it and the shortfall named when they differ (R1.3a) |
| Projection line | `Remaining on {line item} after this expense: {amount}` — red/bold when negative (R3.7). |
| Proof of payment | Multi-file upload (images/PDF), 1–n, thumbnails, remove; required to be documentation-complete. Files count only after server-side process & attach succeeds (R4.6) — failed files show the R12 `upload-failed` chip. |
| Receipt / justification | Multi-file upload (receipt, invoice, or timesheet) — OR checkbox `No receipt available` revealing a required reason textarea (empty → R12 `no-receipt-reason-required`; prints per R6.7). Checking it hides the upload; already-attached receipt files are kept until save, then deleted (confirmation inline) — service rejects the combined state (R4.2). |
| Supporting documents | Repeatable: type select (R11.1) + file; list with remove. |
| Note (inline) | Optional single-line, label `Note (optional)`; prints highlighted on the heading beside any exclusion note (R6.5). Helper: `A short extra remark, highlighted next to this expense on the cover sheet.`, followed by `The automatic note prints too: {note}` when an exclusion note will print (R6.5a, usability #26). |
| Narrative | Required textarea (R4.7, prints per R6.6), label `Narrative (required)` in the muted style of Note's "(optional)", helper: `A sentence or two on what this was for. Prints as a paragraph under this expense on the cover sheet.` (usability #26). |

## Behavior
- Save validation (usability #24, #25): the server checks every rule at once (`validateFields` in `src/modules/expenses/validation.ts`) and returns every problem in one result, keyed by field. Each invalid field shows its own red message directly under it, gets a red border, `aria-invalid="true"` and `aria-describedby` pointing at that message; the first one is scrolled to the middle of the screen and focused; and `Check the highlighted fields.` shows above Save. Typing into a field clears its message. The per-field messages: `Enter a name.`, `Choose a funding source.`, `Choose a line item.`, `Choose a payment source.`, `Choose a month.`, `Enter a valid date.`, `Enter a valid subtotal, like 1234.56.` (tax and fees alike), `Enter the reason no receipt is available.`, `Enter a narrative for this expense.` (R4.7). Amounts default 0. A refusal that is not about one field (locked month, archived source, a line item deleted mid-save, session expired) shows as one panel message instead. The draft and invoice paths keep one sentence (`validate`, derived from the same rules), with `Enter a name, choose a line item, and choose a payment source.` for the first three. Before any rule, every path (create, update, draft save, invoice import) checks the request is shaped like the form's: text fields are strings and checkboxes real booleans. Anything else (the text "false" for No receipt available, a number for a text field, no object at all) is refused as one panel message, `That couldn't be completed. Reload the page and try again.` (`UI.requestRefused`), never read as true or thrown.
- Saving without proofs/receipt is **allowed** (capture-first philosophy) — the record is simply documentation-incomplete and shows up in gates (R4.5 pattern). The toast after a save names every gap the gate will still hold it for, counting files queued in the form (usability #30): `Expense saved. It's still missing proof of payment and a receipt.`, `... missing proof of payment.`, `... missing a receipt.`, or plain `Expense saved.` when complete (a ticked "No receipt available", or an invoice card's invoice, covers the receipt). A draft save keeps `Draft saved.`. Narrative has no such passive path: unlike proof/receipt, it blocks the save itself (R4.7) rather than only gating the download later. Expenses saved before R4.7 existed keep whatever narrative they have (possibly none) and are not rejected on read, only on the next save.
- Uploads: presigned POST direct to S3 (server-generated docId keys under the client-generated expense uuid), then `attachDocument(docId)` runs process & attach (R4.6) with progress + per-file status chips. `createExpense` receives the expense uuid + the list of attached docIds — never raw S3 keys. Abandoned drafts are removed by the nightly sweep (>24 h, no expense row).
- Document removals (chips' ×) are immediate and labeled "Removed now — not undone by Cancel"; Cancel discards field edits only.
- After save: to Expenses list, new row highlighted. Edit mode identical, prefilled, plus Delete (confirm dialog). Projection uses the edit-mode formula (R3.7). Editing a month marked Submitted shows the R10.6 warning banner — keyed by `{fundingSourceId}:{month}` (D-93), so it fires if either the current or a newly chosen source has that month submitted.
- **Locked month (R10.7, D-96):** opening an expense whose own (source, month) is locked shows `{Month YYYY} is locked. Unlock it on the Month-End Packet tab to make changes.` at the top; every field is disabled, files can't be added or removed (attached files stay viewable), and there is no Save or Delete. Choosing a locked (source, month) while adding or editing shows the same message in place of the R10.6 warning, and Save is refused. The server refuses every write to a locked month whatever the page shows — a page opened before the lock included.
- Auto-learn: on save, upsert name → (line item, description) into vendor library.
- **Moving the funding source (edit only, D-93):** allowed at any time; moving *into* an archived source is refused, editing an expense that already sits on one is not. Changing the source or the month claims a new reference in the target `(source, month)` (R2.6) — the same "moved" logic, generalised.

## Reading amounts from documents (Phase 10, D-105; Phase 19, D-133)
When `canReadAmounts` is true for the organisation, a panel appears directly under the
Subtotal/Tax/Fees row. On Add, reading starts as soon as a receipt or proof is chosen; on Edit,
nothing reads on opening, but choosing a new receipt or proof starts reading every file on the
expense, the attached ones too, exactly as "Read amounts from documents" does (Phase 19; hidden
when the expense has no receipt/proof queued or attached, or the month is locked). A draft
reads only on the button, and an invoice card as on Add. When is decided in one place,
`readingFor` in `src/domain/amount-suggestion.ts`. The panel shows "Reading N
documents…" while any file is still in flight, nothing when none could be read (each file row
already says "No amount found"), or the found amounts per file plus a
combined total — receipts summed as the suggestion, proofs summed as a check against them
("✓ matches" or the "Receipts add up to… but proofs show…" warning). "Use these amounts" fills
only Subtotal/Tax/Fees, after a confirm if the fields already hold a non-zero value; Dismiss
hides the panel until the set of files changes. Nothing is ever sent to OpenAI unless the
organisation's plan, its Settings switch, and the server's OpenAI key/model are all present
(`src/modules/ai/access.ts`).

**A receipt's vendor and date (Phase 19, D-133).** The same read also returns who was paid and
the date on each receipt (never a proof of payment). On Add and Edit, never a draft or an
invoice card, a box just above the amounts panel offers "Vendor on this receipt: Home Depot"
and "Date on this receipt: 9/12/2026", each with an **Add** button:

- Vendor Add fills **Name**, in the vendor library's spelling when the receipt's vendor is a
  remembered one (`matchLibraryVendor`, `src/domain/vendor-match.ts`: capitals, punctuation, a
  leading "The", store numbers and endings like Inc, LLC or .com ignored, nothing looser, and a
  tie is not guessed). Vendor memory then fills line item, description and payment source
  blanks-only, but never the remembered amounts (R8.1 "Added from a receipt").
- Date Add fills **Date** only; the reporting Month stays as it is (R2.2).
- A vendor is offered only when every receipt names the same business, a date only when they all
  show the same day. A row disappears once the field already holds it (Name compared ignoring
  capitals and spaces), so there is no dismiss. A future date is never offered. The field that
  changed is briefly highlighted.
- Nothing is compared, flagged or stored: the box is a suggestion only, and Save works whether
  or not it is used, or still reading.

## Server surface
`createExpenseAction(input)`, `updateExpenseAction(input)`, `deleteExpenseAction`, `presignExpenseUpload` (quota-checked, R13), `attachDocument(docId)`, `deleteExpenseDocument(docId)`, `searchVendorsAction(q)` (all in `src/modules/expenses/actions.ts`). `ExpenseInput` carries `fundingSourceId`; every write verifies it via `requireOwnedFundingSource` and refuses an unowned or (on create, or when moving into it) archived source.

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
2. "Line item" select, value "Salary", with a subtle #F3E9DD autofill flash background
   on this and the description field.
3. "Payment source" select, value "Paid by us, reimbursement requested" (other options:
   "Invoiced to fiduciary in advance", "Paid directly by fiduciary").
4. Side-by-side row: "Reporting month" select (value "March 2026", helper "The month whose
   packet this expense goes in. It can differ from the date.") and "Date" date input (value
   03/02/2026).
5. "Description / role" textarea, value "Director", helper "Prints in the cover sheet table
   next to the name, exactly as typed. For a salary, the person's role."
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
12. "Note (optional)" text input, helper "A short extra remark, highlighted next to this
    expense on the cover sheet."
13. "Narrative (required)" textarea, "(required)" in muted regular weight, helper "A sentence
    or two on what this was for. Prints as a paragraph under this expense on the cover sheet."

Bottom: primary "Save expense" button and a quiet "Cancel" link. Also show the validation
error style once: the Name input with a red border and red text "Enter a name." directly under
it, and a red panel "Check the highlighted fields." above the save button.
```
