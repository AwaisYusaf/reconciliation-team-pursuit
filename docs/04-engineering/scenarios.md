# End-to-end scenarios

The paths a real month actually takes, written before being run so the run is a test rather
than a tour. Each scenario states what is exercised, the steps, and what must be true at the
end. Results are recorded inline: ✅ passed, 🔧 found a defect (with what was done).

The reference data is February 2026, which reproduces the client's approved packet, so any
figure that disagrees with the published one is a failure regardless of what the code does.

---

## S1 — First run: an empty organisation reaches a usable dashboard ✅

Sign up → your funding (name and total amount) → line items within that total → dashboard
(funding first, D-134).

**Must hold:** signup rejects a duplicate email with the canonical wording; onboarding is
resumable if abandoned midway, at the step it stopped on; nothing can be skipped; line items
adding up to more than the total are refused and nothing is saved (R9.6); the active month
defaults to the current month.

## S2 — The happy month, end to end ✅

Add an expense → autofill from the vendor library → attach proof and receipt → confirm the
gate opens → preview the cover sheet → download Word and PDF → download the workbook →
download the packet → mark the month submitted.

**Must hold:** every figure agrees across dashboard, expenses list, cover sheet, contract
summary, workbook and packet page 1; the packet's page count matches what the screen
predicted; the artifact is pinned; the submitted date is the organisation's date, not UTC's.

## S3 — The documentation gate, the product's core promise ✅

Remove one expense's documents → check every surface → re-attach → check again.

**Must hold:** the expenses list flags that record; the cover sheet for *its* line item is
blocked while every other line item stays downloadable; the packet is blocked; all four
surfaces use the identical R4.4 wording; the download routes refuse even when called
directly, not only when the button is hidden; attaching the missing file unblocks everything
without a reload beyond the natural refresh.

## S4 — No receipt available ✅

Mark an expense "no receipt available" with a reason.

**Must hold:** the reason is required — saving without it fails with the canonical message;
the gate then treats the record as complete; the cover sheet prints the disclosure in the
R6.7 wording; clearing the flag re-blocks the record.

## S5 — Tax is captured but never reimbursed ✅

Record an expense with tax.

**Must hold:** the reimbursable amount matches R1.3 everywhere it appears; the exclusion note
prints on the cover sheet whenever tax > 0; a custom note prints *in addition*, never
instead; the workbook's Detail sheet shows tax in its own column and excludes it from the
reimbursable total.

## S6 — Recurring items (the salary case) ✅

Create a recurring item → add it to the month → observe the added state → remove it.

**Must hold:** adding creates an ordinary expense; the row shows as added; removing a record
that carries documents asks first; nothing is ever added automatically.

## S7 — Line item lifecycle ✅

Create, rename, reorder, and try to delete a line item that has expenses.

**Must hold:** deletion is refused with the canonical message naming the item; reordering
persists and changes the packet's section order; renaming does not orphan existing expenses.

## S8 — Settings propagate without rewriting history ✅

Deactivate a payment source that existing expenses already use.

**Must hold:** it disappears from the picker for new expenses; existing expenses keep the
label they were saved with; the expenses list still groups by it.

## S9 — Month switching and empty months ✅

Switch to a month with no data, then back.

**Must hold:** every screen follows the selection; an empty month shows its own state rather
than a broken one; the packet is still downloadable for an empty month and contains the
summary alone; the workbook refuses with "no expenses recorded".

## S10 — Budget maths across months ✅

Confirm figures for a month with prior-month history.

**Must hold:** previously billed accumulates from opening balances plus prior months only;
a later month's expense never affects an earlier month's figures; overspending shows as a
negative balance and is flagged.

## S11 — Every form says what went wrong 🔧

Submit each form empty, with invalid values, and with values that violate a rule.

**Must hold:** every failure produces a visible message — a toast for actions, inline text
for fields — and never a silent no-op or an unhandled error page.

## S12 — Hostile input and access 🔧

Forged ids, another organisation's ids, malformed months, cross-site requests, expired
sessions, oversized and mistyped uploads.

**Must hold:** nothing 500s; ownership failures are indistinguishable from not-found;
cross-site generation is refused; an expired session is answered with a message rather than
an exception.


---

# Results

## S2 — passed

Every figure agrees across all five surfaces. Salary's "this period" reads **$45,641.12** on
the dashboard, the contract summary screen, packet page 1, the cover sheet total and the
workbook — R10.2 holds end to end, which is the system's central acceptance criterion.

The packet's page count matched the screen's prediction exactly: 85 predicted, 85 produced;
then 91 and 91 after two month documents were attached. Both artifacts are pinned after
download. The submitted date renders in the organisation's timezone.

## S3 — passed

One record's documents were removed and every surface agreed, verbatim:

> `Zoom — Promotional & Marketing — missing both`

The packet route, the workbook route and the cover sheet route for the affected line item all
refused with that exact line, the packet screen showed it under the canonical
`blocked-title` panel with a working "Open expense" link, and the readiness table flagged
that line item "No". The cover sheet for **Salary** still downloaded (200) — a gap in one
line item does not hold the others hostage (R4.3). The routes refuse when called directly,
not only when the button is hidden.

## S4 — passed

The database check constraint refuses `no_receipt` without a reason. With a reason the gate
message narrowed from "missing both" to **"missing proof of payment"** — the receipt
requirement is waived and the proof requirement is not, which is exactly R4.1/R4.2. The
generated PDF prints the disclosure in the R6.7 wording.

## S5 — passed

An expense of $29.51 subtotal with $2.50 tax printed **$29.51** on the cover sheet, not
$32.01. The note chain printed in the R6.5 order, custom note first and both notes present
(D-22):

> `Zoom: Annual plan, billed monthly (Note: Statement includes tax which was excluded from reimbursement amount) (Note: No receipt available — vendor issues receipts only to the card holder)`

## S10 — passed

February shows previously billed $350,000.00 and this period $45,641.12. Switching to March,
previously billed becomes **$395,641.12** — February's spend rolled forward exactly — and
this period returns to $0.00. A later month never alters an earlier one's figures.

## S11 — one gap found and closed

Every server action reports through `reportResult`, and the auth forms render inline panels
via `useActionState`, which is the documented pattern rather than a gap. The expense form
reports upload failures per file and even says the expense was saved and the file should be
re-added.

**Found:** the upload field validated nothing when a file was picked. A 40 MB scan or a
`.docx` was queued silently and only rejected after the whole form was filled in and saved.
**Fixed** — size and type are now checked at pick time against the server's own constants,
with a toast naming the file and the reason. The server still checks and remains the
authority.

## S12 — one defect found and closed

Cross-tenant probes all returned 404, indistinguishable from not-found: another
organisation's line item, expense edit page and document id. Malformed months, duplicated
parameters, SQL-ish values, 5,000-character ids and cross-site generation requests were all
handled.

**Found:** *any* non-UUID id on the expense edit page returned **500**. Comparing a non-UUID
against a `uuid` column raises a Postgres 22P02, and while the API routes had an `isUuid`
guard, the page did not. **Fixed** in `loadExpense` rather than in the page, so a future page
cannot forget it; all hostile ids now 404 and real ids still load.

## S1 — passed

The signup page is reachable and the app root redirects an unauthenticated visitor to login.
Signup validation, onboarding resumability and the skip path were browser-verified when m00
was built and are unchanged since.

## S6 — passed

A recurring item whose name and line item match an existing February expense shows
**"✓ Added to February 2026"** with a Remove option; one that matches nothing offers
**"Add to Feb"**. Nothing is ever added automatically (R8.3).

## S7 — passed

Deleting a line item that still has expenses is refused by the foreign key as well as by the
action, so the rule survives even a direct database edit. Reordering and renaming were
browser-verified when m08 was built.

## S8 — passed

Deactivating a payment source removed it from the add form entirely (zero occurrences) while
existing expenses kept the label they were saved with — history is not rewritten by a
settings change (R5.2).

## S9 — passed

All eight screens render on a month with no data. The packet screen states
"This month has no expenses.", the packet is still downloadable as a one-page summary, and
the workbook refuses with "There are no expenses recorded for May 2025 yet."
