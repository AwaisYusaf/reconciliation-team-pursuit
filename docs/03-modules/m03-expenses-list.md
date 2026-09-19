# m03 — Expenses List

## Purpose
Everything recorded for the active month: totals by payment source, filters, documentation status at a glance, entry point to fix/edit/delete.

## Scope
Route `/r/expenses`. Read view + row actions (edit navigates to m02; delete with confirm). Scoped by the header's funding-source selection (§14); with **All** selected (only possible once an org has more than one source), an additional `?source=` filter narrows the list further (D-93).

## Data
Reads `expenses` + `expense_documents` (status), `funding_sources` (names, for the column and filter), calculation service for card totals. Deletes via m02's `deleteExpenseAction`.

## Behavior
- With one source selected: one summary card per active payment source (R5.2), label = the org's source label, value = Σ reimbursable for the month (retired labels present in the month get their own card) — unchanged from before D-93.
- With **All** selected: one card per **funding source** instead (D-93) — never per payment source across funders, and never a single combined figure, since different funders' money is not one budget.
- With more than one funding source in the org, the table gains a **Funding source** column, and an additional filter appears when All is selected: "Filter by funding source" (All funding sources + each active source, plus any archived source with an expense in the current month) — server-validated via `findFundingSource`; an unrecognised id is just treated as All.
- Filters: line item (All + each), payment source (All + each), and **documentation** — `All
  records | Missing documentation | Missing proof of payment | Missing receipt/justification |
  Missing narrative`; all combinable, and combinable with the search box and the funding-source filter above.
  - The documentation filter reads the row's `missing` (`MissingKind | null`), which the page
    already gets from `documentationStatus` — the same judgement as the packet's blocking list
    (R4.3). It is never re-derived from the row's document arrays: that would agree today and
    diverge the day R4.1/R4.2 change, with nothing failing.
  - A record missing **both** answers to *either* specific choice, since it is genuinely missing
    each of them; bucketing "both" separately would hide the worst records from the two filters
    most likely to be used to find them.
  - The incomplete strip's count runs through the same predicate as the filter, so the number
    shown and the rows the filter returns cannot disagree.
- Table: `Ref / Date | Name | Line item | [Funding source] | Payment source | Amount | Proof | Receipt | Supporting | Narrative |
  (actions)` — the Funding Source column only appears when the org has more than one source.
  Headers are kept short and the reference shares its column with the date so the
  whole table fits the 1220px content width (widened from 1100px for the Narrative column)
  without scrolling sideways, from the `xl` viewport breakpoint up — a table that scrolls
  hides its own row actions. "Amount" is unqualified on purpose: R1.3 defines that as the
  reimbursable one. The reference is the click target for every document filed under the
  expense (R2.6).
  - Proof column: `{n} attached` with first-file thumbnail, or bold red `Missing` (R4.1).
  - Receipt column: `{n} attached`, or `No receipt (reason)` in secondary text when flagged (R4.2), or bold red `Missing`.
  - Supporting: count.
  - Narrative column: `Provided`, or bold red `MISSING` (R4.7) — same visual treatment as Proof/Receipt, though narrative is a field rather than an uploaded file.
  - Actions: Edit · Delete. For a row whose (source, month) is locked (R10.7, D-96), Delete is disabled and shows the locked-month message; Edit still opens the expense, read-only. Trash's Restore and Delete permanently behave the same for a trashed row in a locked month.
- Row order: the per-month insertion counter (`sort_order`, data-model). Empty state: `No expenses recorded for {Month YYYY} yet.`
- A thin status strip above the table when the month has incomplete records: `{n} expenses are missing documentation. Show only those or go to the Month-End Packet.` (links) — keeps the gate visible early.

## Acceptance
Card totals + table agree with dashboard/summary; filters compose; deleting prompts, then removes S3 objects best-effort inline with the nightly sweep as backstop (data-model §Cleanup); incomplete strip counts match the packet blocking list.

---

## Claude Design prompt

```
Design the EXPENSES screen inside the app chrome (month "March 2026", Expenses tab active).

h1 "Expenses this month", subtext "March 2026".

Row of three summary cards (bordered, white): labels in 13px #5B5147 / values 20px bold —
"Paid by us, reimbursement requested — $85,522.29", "Invoiced to fiduciary in advance —
$6,083.33", "Paid directly by fiduciary — $2,676.00".

Below, a warning strip (thin, #F6E7E4 background, #8A2A22 text): "3 expenses are missing
documentation. Show only those or go to the Month-End Packet.", the last two underlined. "Show only those" applies the Missing documentation filter, and flips to "Show all expenses" while it is on.

Filter row: "Filter by line item" select (All line items) + "Filter by documentation" select
(All expenses) + "Filter by payment source" select (All payment sources).

Table with uppercase headers: Date | Name | Line Item | Payment Source | Reimbursable Amount
| Proof | Receipt | Supporting | (blank). 8 rows of realistic data:

3/2/2026  Quincy Smith        Salary                    Paid by us…   $9,211.50  2 attached  1 attached          1
3/2/2026  Misty Smith         Salary                    Paid by us…   $7,596.16  2 attached  1 attached          0
3/3/2026  Just Smash It       Social Services & Support Paid by us…   $350.00    1 attached  1 attached          0
3/5/2026  High Level          Promotional & Marketing   Paid by us…   $695.00    1 attached  1 attached          0
3/8/2026  Stock Media         Promotional & Marketing   Paid by us…   $1,500.00  MISSING     1 attached          0
3/10/2026 Theyluvtolo         Social Services & Support Paid by us…   $40.00     1 attached  No receipt (CashApp only)  0
3/12/2026 Mantaq (Kaleem)     Analytical Support        Invoiced…     $1,000.00  1 attached  1 attached          1
3/16/2026 JDS Silkscreen & Embroidery  Promotional & Marketing  Paid by us…  $8,173.00  MISSING  MISSING     1

"MISSING" renders bold #8A2A22; "No receipt (CashApp only)" renders in #5B5147 italic.
"attached" cells include a 28px square thumbnail. Each row ends with quiet "Edit" and
"Delete" text links. Show small 28px thumbnails next to attached counts.

Add the empty-state variant at the bottom as a separate small demo card: dashed border box,
"No expenses recorded for March 2026 yet."
```
