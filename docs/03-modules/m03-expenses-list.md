# m03 — Expenses List

## Purpose
Everything recorded for the active month: totals by payment source, filters, documentation status at a glance, entry point to fix/edit/delete.

## Scope
Route `/expenses`. Read view + row actions (edit navigates to m02; delete with confirm).

## Data
Reads `expenses` + `expense_documents` (status), calculation service for card totals. Deletes via m02's `deleteExpense`.

## Behavior
- One summary card per active payment source (R5.2), label = the org's source label, value = Σ reimbursable for the month (retired labels present in the month get their own card).
- Filters: line item (All + each) and payment source (All + each); combinable.
- Table: `Date | Name | Line Item | Payment Source | Reimbursable Amount | Proof | Receipt | Supporting | (actions)`.
  - Proof column: `{n} attached` with first-file thumbnail, or bold red `Missing` (R4.1).
  - Receipt column: `{n} attached`, or `No receipt (reason)` in secondary text when flagged (R4.2), or bold red `Missing`.
  - Supporting: count.
  - Actions: Edit · Delete.
- Row order: the per-month insertion counter (`sort_order`, data-model). Empty state: `No expenses recorded for {Month YYYY} yet.`
- A thin status strip above the table when the month has incomplete records: `{n} records are missing documents — view Month-End Packet` (link) — keeps the gate visible early.

## Acceptance
Card totals + table agree with dashboard/summary; filters compose; deleting prompts, then removes S3 objects best-effort inline with the nightly sweep as backstop (data-model §Cleanup); incomplete strip counts match the packet blocking list.

---

## Claude Design prompt

```
Design the EXPENSES screen inside the app chrome (month "March 2026", Expenses tab active).

h1 "Expenses This Month", subtext "March 2026".

Row of three summary cards (bordered, white): labels in 13px #5B5147 / values 20px bold —
"Paid by us, reimbursement requested — $85,522.29", "Invoiced to fiduciary in advance —
$6,083.33", "Paid directly by fiduciary — $2,676.00".

Below, a warning strip (thin, #F6E7E4 background, #8A2A22 text): "3 records are missing
documents — view Month-End Packet" with the last part underlined.

Filter row: "Filter by line item" select (All line items) + "Filter by payment source" select
(All payment sources).

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
