# m07 — Contract Summary

## Purpose
On-screen mirror of the Excel summary: contract-to-date position per line item + advance reconciliation, for the active month.

## Scope
Route `/r/contract-summary`, scoped to the header's selected funding source (§14, D-93) — requires one source picked, shows `PickFundingSource` when "All" is selected. Read-only table + reconciliation card + Excel download (same generator as m06, for that source).

## Data
Calculation service (R3, R7); the selected source's own row via `loadFundingSourceSettings` (D-93 — no longer `contract_settings`, which is deprecated), `line_items` + `line_item_performances` (R9.5), all scoped to that source. No writes.

## Behavior
- Context strip: `Contract {number}` · `Contract total: {amount}` · `Base PO {n}` · `Performance PO {n}` · `Invoice period: {M/1/YYYY to M/lastday/YYYY}` (R7.3, R2.4). Items with empty settings are hidden. (The Performance PO field is metadata only — unrelated to R9.5's performances, which are amounts on individual line items.) `Contract total` is the configured contract value **plus every *new* line item performance total** when a value is configured (R7.3, D-82) — new meaning added since m08 shipped, real budget the org hasn't caught up to in Settings yet. A migrated performance (the Performance Grant included) is excluded: that money was already inside the configured value before it had a line item of its own, so adding it again would double it. Falls back to the sum of scheduled values (which already includes every performance, migrated or new) when unset.
- Table per R7.1/R7.3: BASE section header row → line item rows (every line item is BASE now; one may be built from performances, R9.5) → bold `Totals`. No separate subtotal or Performance Grant section (R7.2 retired, D-80) — `Totals` is the only bottom-line row. Columns exactly: `Description of Work | Scheduled Value | Previously Billed | This Period | Total Billed to Date | % Complete | Balance to Finish`. A line item with a performance shows its split right there, not only in the Line Items screen's "Add" popup: its name reads `{name} (includes {amount} performance)` — the Scheduled Value cell still shows the combined total.
- Reconciliation card per R7.4 (4 rows).
- Button: `Download summary (Excel)` (reuses m06's `downloadSummary`) — gated like m06 (R4.3); when disabled, an inline line explains: `Blocked: {n} expenses are missing documentation. See the Month-End Packet tab.`
- **Reporting periods (R10.7, D-96):** every month for this source that has live expenses, a submission or a lock, newest first (a month whose only expenses are trashed is left out) — `Month | Status | Details`. `Open` → `—`; `Submitted` → `Submitted {date}`; `Reconciled` → `Locked {date} by {name} · View signed packet`. A month that was unlocked and locked again lists what happened beneath it, oldest first: `Locked {date} by {name} · View signed packet (replaced)` and `Unlocked {date} by {name}: "{reason}"`. Read via `loadReportingPeriods`; still no writes.

## Acceptance
Every figure equals the Excel for the same data (R10.2); % formats per R1.5; hidden-when-empty settings behave; disabled state explains itself; Reporting periods shows Open, Submitted and Reconciled correctly for the selected source.

---

## Claude Design prompt

```
Design the CONTRACT SUMMARY screen inside the app chrome (month "February 2026", Contract
Summary tab active).

h1 "Contract Summary". Under it a context strip in 16px #5B5147, items separated by wide
gaps: "Contract 6007211" · "Contract total: $940,000.00" · "Base PO 3086984" · "Performance
PO 3089749" · "Invoice period: 2/1/2026 to 2/28/2026".

Wide table (horizontal scroll on small screens) with uppercase headers: Description of Work |
Scheduled Value | Previously Billed | This Period | Total Billed to Date | % Complete |
Balance to Finish. Money right-aligned.

Section header row spanning all columns, #F1ECE2 background, bold: "BASE". Then rows:
Salary                      $458,692.46  $350,000.00  $45,641.12  $395,641.12  86%  $63,051.34
Analytical Support          $66,929.14   $40,000.00   $19,890.83  $59,890.83   89%  $7,038.31
Promotional & Marketing     $58,212.62   $48,198.51   $11,851.65  $60,050.16   103% -$1,837.54
Social Services & Support   $41,250.00   $30,000.00   $10,231.08  $40,231.08   98%  $1,018.92
Community Programs & Events $39,832.45   $13,985.96   $4,251.28   $18,237.24   46%  $21,595.21
Professional Development    $15,000.00   $1,749.00    $1,599.00   $3,348.00    22%  $11,652.00
Performance Grant 1         $175,000.00  $39,229.50   $0.00       $39,229.50   22%  $135,770.50
Bold row: "Totals" $854,916.67 · $523,162.97 · $93,464.96 · $616,627.93 · 72% · $238,288.74

Below-left, a reconciliation card (max 460px, bordered white, rows separated by hairlines,
label left / value right):
"Total advances received — $665,000.00"
"Total reconciled to date — $616,627.93"
"Balance remaining to reconcile — $48,372.07"
"Percentage of advance payments reconciled — 93%"

Then a primary button "Download summary (Excel)".
```
