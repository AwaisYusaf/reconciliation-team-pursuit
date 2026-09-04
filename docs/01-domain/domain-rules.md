# Domain Rules

Binding rules for all screens and generators. Module specs and code reference these by section number — do not restate them elsewhere. (Revised per `04-engineering/review-2026-08-16.md`.)

## 1. Money

- **R1.1** All amounts are **integer cents** in code and DB. Convert only at render/parse edges.
- **R1.2** Display format everywhere (UI and documents): `$#,##0.00` → `$3,916.70`, `$19,890.83`. Negative: `-$145.00`. No bare numbers, no dropped cents (fixes manual inconsistencies like `$1404`, `1015.99`, `$3.916.70`).
- **R1.3** **Reimbursable amount = subtotal + whichever of tax and fees this funder allows.** Different funders reimburse differently, so each expense records two flags — `tax_reimbursable`, `fees_reimbursable` — whose defaults come from the **payment source** (the funder is what decides; set once per source, not re-decided per expense). The expense keeps its own copy from the moment it is saved, so changing a funder's rule never restates a figure already claimed. **Every** path that creates an expense resolves the flags through `reimbursementRulesFor` — the columns carry no default, so omitting them is a type error rather than a silently different claim (D-71). Existing data was migrated to the original rule — tax excluded, fees included — so no historical figure moved (D-67).
- **R1.3a** **Receipt total = subtotal + tax + fees, always.** What the document says, regardless of what is claimed from it. Shown beside the reimbursable amount on the expense form and as its own column in the Excel detail sheet, so a reviewer can reconcile the claim against the attached receipt. Derived, never entered — it has one correct value.
- **R1.3b** All "amount", "spent", "billed" figures in the system mean **reimbursable** unless explicitly labeled.
- **R1.4** Negative amounts are allowed (refunds — e.g., ClickUp −$145) and net into every total.
- **R1.5** Percentages on documents and screens: whole numbers (`66%`), **rounded half away from zero** (84.92→85, 103.16→103), implemented once in `format.ts`. Division by zero → `0%`.

## 2. Months, dates & time

- **R2.1** Reporting month key: `YYYY-MM`. Display: `February 2026`. Ordering is chronological on the key.
- **R2.2** Every expense belongs to exactly one month (defaults to the active month at creation; **editable from the expense form**). **Expense date is independent of month** — a February expense may be paid 03/09 (real case). Date defaults to today, is not constrained to the month, and prints nowhere on cover sheets (it appears in the Excel detail sheet).
- **R2.3** The active month is app-wide UI state, persisted per organisation (`organizations.active_month`): dashboard, lists, cover sheets, packet, and summary all reflect it.
- **R2.4** Invoice period string for documents: `M/1/YYYY to M/<lastday>/YYYY`.
- **R2.6** **Expense reference:** every expense carries a number unique within its month, printed as `{month}-{seq}` (e.g. `2026-02-014`, three digits, growing past that rather than truncating). Assigned at insert from a per-month counter on `month_statuses`, advanced under the insert's own row lock, and guarded by a unique index on (org, month, reference_seq) — deliberately **not** `sort_order`, which races on assignment and is reused after a delete. A deleted expense leaves a gap; its number is never reissued. The column carries **no default** and a check constraint refuses anything below 1, so an insert path that forgets to claim a number is a type error rather than two rows silently colliding (D-63). Reassigned when an expense is moved to another month, because the reference names the packet it appears in. It is printed in the packet's expense index (packet-pdf-spec §1b) and in the page footer of every page documenting that one expense (R10.5, D-70) — but never inside the cover sheet's three-column table, which is the approved layout and neither gains a column nor has its text edited.
- **R2.5** **Timezone:** all date-only values, "today", "current month", and period boundaries are computed in the fixed organisation timezone **America/Detroit** — never via UTC conversion. (A UTC server must not flip Detroit's date after ~8 pm.)

## 3. Budget math (per line item, per month)

Let `opening` = line item's opening previously-billed balance (setup figure), `earlier` = Σ reimbursable of its expenses in months < M, `thisMonth` = Σ reimbursable in month M.

- **R3.1** `previouslyBilled(M) = opening + earlier`
- **R3.2** `spentThisMonth(M) = thisMonth`
- **R3.3** `totalBilled(M) = previouslyBilled + spentThisMonth`
- **R3.4** `remaining(M) = scheduledValue − totalBilled`
- **R3.5** `%complete(M) = totalBilled / scheduledValue` (R1.5 rendering)
- **R3.6** **Low-budget warning** (app screens only — never inside generated documents): `remaining / scheduledValue < 0.10` → red emphasis on Remaining. When `scheduledValue ≤ 0`, warn only if `remaining < 0`.
- **R3.7** Add-expense projection: `remaining − currentFormReimbursable`, styled as warning when < 0. **Edit mode:** compute `remaining` excluding the expense being edited, then subtract the live form value (no double-count).
- **R3.8** **Monthly activity and the cumulative grant are two views, never one table.**
  - *Month view*, per line item: `opening = scheduledValue − previouslyBilled(M)`, `thisMonth = spentThisMonth(M)`, `closing = remaining(M)`. Stated as budget **remaining** rather than billed-to-date, so the row reads as a statement — `opening − thisMonth = closing` — and each month opens exactly where the last closed.
  - *Grant view*: `approved = Σ scheduledValue`, `spentToDate = Σ totalBilled`, `remaining = approved − spentToDate`. No month appears in it.
- **R3.9** **A month's figures are recorded when it is submitted** (`month_snapshots`, D-68). A record, not a lock: corrections still flow into the live figures exactly as before, and when the two differ the screen names every category that moved and by how much. Un-submitting discards the record, because figures labelled "as submitted" would otherwise assert something untrue; the pinned artifact still holds the bytes actually delivered (R10.6). The performance grant and advances-received have no month dimension of their own (R7.2, R7.4) — what is captured is their value **at submission**, which is what that packet was built from.

## 4. Documentation gate

- **R4.1** Every expense requires **≥ 1 proof of payment**. No exceptions, no overrides.
- **R4.2** Every expense requires **≥ 1 receipt/justification document** (receipt, invoice, or timesheet) **unless** it is explicitly marked `noReceipt` with a non-empty reason. The reason prints on the cover sheet (R6.7). `noReceipt` and attached receipt documents are mutually exclusive: saving with `noReceipt = true` deletes the expense's receipt documents (after an in-form confirmation); the service layer rejects the combined state.
- **R4.3** An expense violating R4.1/R4.2/R4.7 is **documentation-incomplete**. While any expense in the active month is incomplete, packet PDF and summary Excel downloads are **blocked**; cover sheet downloads for a line item are blocked while that line item has an incomplete expense.
- **R4.4** The blocking UI intro line is `The following records are missing a receipt/justification, proof of payment, or narrative:` and each record renders as `{name} — {line item} — missing {reasons}`, where `{reasons}` is `proof of payment` / `receipt/justification` / `narrative` for a single gap, the fixed legacy phrase `both` for proof-of-payment-and-receipt together (unchanged since before R4.7 existed), and otherwise the missing items joined in plain English with an Oxford comma (e.g. `proof of payment and narrative`, `proof of payment, receipt/justification, and narrative`) — with a direct link to edit that expense.
- **R4.5** Recurring one-click adds create expenses with **no documents** — they are intentionally incomplete until the user attaches files (the gate is the reminder). The created expense's narrative comes from the template's own default narrative (m05); a template saved with no default narrative produces an expense that is also incomplete under R4.7 until the narrative is filled in — the same reminder mechanism, not a save-time block, since the one-click add never goes through the expense form's validation.
- **R4.6** A file counts as attached only after the server-side **process & attach** step succeeds (validation, conversion, page count — see data-model §Upload processing). Failed files show a per-file error and do not satisfy R4.1/R4.2.
- **R4.7** Every expense requires a **non-blank narrative**. Unlike R4.1/R4.2, this is enforced **at save time**: the expense form rejects a create or an update with an empty or whitespace-only narrative, naming the reason. Expenses saved before this rule existed are not retroactively invalidated — the column may still be blank for them — but they surface exactly like an R4.1/R4.2 gap: in the Expenses tab's "Missing narrative" filter and row indicator, and in the packet's blocking list (R4.3/R4.4), until someone opens and completes them. The cover sheet still prints the narrative per R6.6.

## 5. Payment sources

- **R5.1** Payment sources are an **org-configurable label list** (SOW §1 commitment), seeded at org creation with exactly these three defaults: `Paid by us, reimbursement requested` · `Invoiced to fiduciary in advance` · `Paid directly by fiduciary`. Editable in Settings (rename / add / deactivate; deactivated labels stop appearing in pickers). A payment source is required on every expense; the expense stores the label text as a historical snapshot.
- **R5.2** Expenses screen shows one total card per **active** source for the active month (Σ reimbursable); expenses carrying retired labels are still shown and grouped under their stored label.

## 6. Cover sheet composition (see `02-outputs/cover-sheet-spec.md` for typography/layout)

- **R6.1** One cover sheet per line item per month. Title: `{docName} {Month YYYY} {Line Item} Breakdown` (docName = Settings "document display name", e.g. "Team Pursuit").
- **R6.2** Table columns `Name | Role | Amount`: Name = expense name, Role = expense description verbatim, Amount = reimbursable (R1.2). Rows in expense insertion order (user-reorderable later; no auto-sort). No blank filler rows. Total row at bottom.
- **R6.3** After the table, the canonical line: **`Please see below for additional information for some of the above items.`** (one wording, always — supersedes the manual docs' variants).
- **R6.4** Then, for every expense, in table order: a bold heading `{Name}:` followed by its proof-of-payment images in upload order, full column width, aspect preserved. Heading names always equal table Names.
- **R6.5** **Inline notes** (yellow-highlighted, appended to the heading, in this order): (a) the expense's custom note if set; (b) the **exclusion note**, whenever part of the receipt was not reimbursed — see R6.5a for which wording and when. Both print when both apply (SOW §2: the disclosure is always appended; a custom note never suppresses it — D-22, amended by D-67).
- **R6.5a** The exclusion note names **what was actually excluded** and prints only when something was — superseding R6.5's original "whenever `tax > 0`", which predates tax being reimbursable. Exact strings, singular "Statement": tax only → **`(Note: Statement includes tax which was excluded from reimbursement amount)`** (the wording approved in the February packet, unchanged); fees only → **`(Note: Statement includes fees which were excluded from reimbursement amount)`**; both → **`(Note: Statement includes tax and fees which were excluded from reimbursement amount)`**. Nothing prints when the whole receipt is reimbursed, or when the excluded part is zero — the note exists to explain a gap between the receipt and the claim, and asserting one that does not exist would put a false statement on a funder document (D-67).
- **R6.6** **Narrative note**: paragraph (plain text, not highlighted) rendered under the heading before the proof images — used for aggregated reimbursements and context (e.g., an out-of-pocket explanation). Required at save time (R4.7); this rule covers how it prints, not whether it exists.
- **R6.7** **No-receipt disclosure:** when `noReceipt`, append a further yellow inline note: `(Note: No receipt available — {reason})`.
- **R6.8** Salary is not special: people are expenses (name = person, role = description), so the Salary cover sheet is the per-person Name/Role/Amount sheet the City already receives.

## 7. Contract summary

- **R7.1** BASE section: one row per line item with Scheduled Value | Previously Billed | This Period | Total Billed to Date | % Complete | Balance to Finish, per §3 for the active month. Base subtotal row sums all.
- **R7.2** PERFORMANCE GRANT section: single row from Settings — `Performance Grant 1`, scheduled = `perfGrantScheduled`, previously billed = `perfGrantBilledToDate` (manually maintained), this period = 0. (In-system perf billing is out of scope.)
- **R7.3** Totals row = base + performance. **Context** (contract number, Base PO, Performance PO, invoice period per R2.4, contract total = `contractValue` if set else scheduled total): the m07 screen shows the full context strip; the packet's summary page shows it as one subtitle line under the title; the Excel contains no context rows (its layout is fixed in `summary-excel-spec.md`). Empty settings values are simply omitted.
- **R7.4** Reconciliation block: `Total advances received` (Settings) · `Total reconciled to date` = grand total billed · `Balance remaining to reconcile` = advances − billed · `Percentage of advance payments reconciled` = billed / advances (R1.5).

## 8. Vendor library & recurring

- **R8.1** Library entries: name → default line item + default payment source + default description + the amounts last paid (subtotal, tax, fees). Amounts are nullable: `null` means nothing has been learned, which is **not** the same as a vendor whose tax really is zero. Add-expense autofill has two modes, deliberately different:
  - **Typed** — an exact case-insensitive match fills line item, description and any blank amount boxes (visible highlight, still editable). It fires from ordinary typing, so it only ever fills blanks and never replaces a choice already made.
  - **Clicked** — substring suggestions (max 6), each showing the line item, payment source, description and last amount it would apply. Clicking is deliberate, so it **overwrites** line item, payment source, description, tax and fees. The subtotal is the exception: a figure already typed is never replaced, because the amount is the field that is genuinely new each time.
- **R8.2** **Auto-learn:** saving an expense upserts its name into the library with the line item, payment source, description and amounts used (latest write wins). A remembered payment source is only offered while its label is still active — a retired one stays readable on the records that already carry it but is never applied to a new expense (R5.2). There is no manual "add vendor" — the library only ever reflects what was actually spent. Entries are editable/deletable in Settings, including their remembered amounts; clearing an amount there restores `null` rather than storing zero.
- **R8.3** Recurring items: name, fixed amount, line item, and optional defaults for description, **narrative**, payment source, tax and fees. Everything set on the template fills the generated expense and stays editable there. **Correcting the narrative on an expense created from a template updates that template**, so the following month starts from the current wording rather than requiring last month to be reopened and copied (D-66). Write-back only from an expense that carries the template's id, and only when the narrative is non-empty — blank means "not written yet", not "delete the paragraph"; clearing is done on the Recurring screen. A remembered payment source that has since been retired is not reused (R5.2). Salaries are the canonical use (one person = one recurring item at monthly pay). "Add to {month}" creates a normal expense (R4.5); the row shows added-state when an expense with the same name (case-insensitive) + line item exists in the month, whoever entered it — informational only. **Remove** only ever targets the newest expense this recurring item actually created (tracked by `recurring_item_id`), and requires a confirm dialog whenever that expense has ≥ 1 document; an expense that merely shares a name and line item but was typed in by hand is never a Remove target, not even behind a confirmation — the button refuses outright, pointing the user at the Expenses list instead. Marking something recurring must never move or remove a record it did not create (D-79). Nothing is ever added automatically.

## 9. Line item lifecycle

- **R9.1** Create: unique name (case-insensitive) + scheduled value; opening previously-billed defaults 0.
- **R9.2** Rename cascades everywhere (historical expenses, vendor defaults, recurring, filters, generated future docs).
- **R9.3** Delete is blocked only when expenses reference the line item (any month): `"{name}" has expenses recorded against it and cannot be deleted.` Deleting an unreferenced line item **cascade-deletes its recurring items** after a confirm dialog listing them; vendor defaults keep the name with their default line item set to null.
- **R9.4** Budget/opening edits recompute all derived figures; documents regenerate on next download — **except pinned artifacts (R10.6), which are never regenerated or replaced**.

## 10. Generation invariants

- **R10.1** Deterministic: same records → same document bytes (timestamps only in file metadata).
- **R10.2** Cover sheet totals, dashboard, summary sheet, and packet always agree — single calculation service.
- **R10.3** File names: cover sheets `{DocName} {Month} {YYYY} {Line Item} Breakdown.docx|.pdf`; Excel `{DocName}_{Month}_{YYYY}_Summary.xlsx`; packet `{DocName}_{Month}_{YYYY}_Packet.pdf` (spaces → `_` in the latter two). All names/slugs pass the single sanitizer (data-model §S3).
- **R10.4** Outputs generate on demand from live data, cached to S3 with an inputs-hash (canonical JSON of the full month snapshot incl. settings and document keys/sizes); a hash miss regenerates.
- **R10.5** Packet page footer on every page: `{DocName} — {Month YYYY} — Page {i} of {N}`. **The footer also carries the expense reference on every page that documents exactly one expense** — receipts and supporting documents — giving `{DocName} — {Month} — {reference} — Page i of N`. Approved by the funder as an addition to the footer they already receive (D-70). Pages belonging to no single expense keep the footer unchanged: the summary, the index, month documents such as the bank statement, and the cover sheet, which covers a whole category. Proof of payment needs no stamp — it is embedded in the cover sheet directly beneath its expense's own heading.
- **R10.6** **Pinning (decision D-21):** every artifact the user actually downloads is retained permanently (`downloaded_at` set; exempt from cache replacement and lifecycle expiry) so the org can always reproduce what was submitted. A month can be marked **Submitted**; editing anything in a submitted month shows a warning banner ("This month was submitted on {date} — changes will not alter the downloaded packet, but regenerated documents will differ.").

## 11. Supporting & month documents

- **R11.1** Supporting document types are an **org-configurable label list** (SOW §1 commitment), seeded with: `Check copy | Request form | Vendor invoice | Event flyer | Narrative | Other`. Editable in Settings; each supporting document stores its label text.
- **R11.2** Month document categories (fixed): `Bank statement | Combined hours | Timesheet | Fiduciary invoice | Other`, each with optional title. **Ordering authority is `packet-pdf-spec.md` §Canonical section order**, implemented once in `packetContents`; UI groups mirror it. The month-documents section is **last** in the packet (D-77).
- **R11.3** Placement in the packet is defined in `packet-pdf-spec.md` — proofs render only on cover sheets; receipts, supporting docs, and month docs render as full pages.

## 12. Canonical strings (verbatim; never paraphrase in output code)

| Key | String |
|---|---|
| tax-note | `(Note: Statement includes tax which was excluded from reimbursement amount)` |
| see-below | `Please see below for additional information for some of the above items.` |
| no-receipt-note | `(Note: No receipt available — {reason})` |
| reimburse-hint (UI) | `Sales tax is excluded. The funder does not reimburse it.` |
| blocked-title (UI) | `This packet cannot be downloaded yet.` |
| blocked-title-line-item (UI) | `Downloads unavailable for this line item.` |
| blocked-intro (UI) | `The following records are missing a receipt/justification, proof of payment, or narrative:` |
| delete-blocked (UI) | `"{name}" has expenses recorded against it and cannot be deleted.` |
| duplicate-email (UI) | `An organisation with that email already exists — sign in instead.` |
| no-receipt-reason-required (UI) | `Enter the reason no receipt is available.` |
| expense-missing-narrative (UI) | `Enter a narrative for this expense.` |
| upload-failed (UI) | `Upload failed — try again.` |
| forgot-password (UI) | `Forgot your password? Email` + a mailto link to `tech@teampursuit.org` |
| tax-exceeds-subtotal-warning (UI) | `Tax is more than the subtotal — double-check this entry.` |
| subtotal-is-zero-warning (UI) | `Subtotal is $0.00 — double-check this entry.` |

## 13. Limits (enforced at presign/save; friendly errors)

- **R13.1** Per expense: ≤ **200 MB** and ≤ **300 pages** (a file count of 500 survives only as a
  runaway guard, not a product limit — a count was the wrong unit, and a low one forced extra line
  items to be invented purely to fit the evidence). Per month: ≤ 50 packet-level documents. Per
  organisation: ≤ **5 GB** total storage (soft cap: refuse the upload with an explanatory message).
  **Measured on stored bytes, not uploaded bytes** — HEIC and WebP are re-encoded to JPEG, so the
  two differ — and including the thumbnail written alongside every image. All of these are checked
  inside one transaction under a per-organisation advisory lock, so concurrent uploads cannot each
  see room and both be admitted (D-64, D-65).
- **R13.2** Per file: images (jpg/png/webp/heic) and PDFs only, ≤ 25 MB — applied to the uploaded bytes *and* re-applied to the stored bytes, because conversion to JPEG grows a file by roughly 1.4×. Encrypted, corrupt, or 0-page PDFs are rejected at process & attach (R4.6).
