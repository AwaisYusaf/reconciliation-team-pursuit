# m07 — Contract Summary

## Purpose
On-screen mirror of the Excel summary: contract-to-date position per line item + performance grant + advance reconciliation, for the active month.

## Scope
Route `/contract-summary`. Read-only table + reconciliation card + Excel download (same generator as m06).

## Data
Calculation service (R3, R7); `contract_settings`. No writes.

## Behavior
- Context strip: `Contract {number}` · `Contract total: {amount}` · `Base PO {n}` · `Performance PO {n}` · `Invoice period: {M/1/YYYY to M/lastday/YYYY}` (R7.3, R2.4). Items with empty settings are hidden.
- Table per R7.1–R7.3: BASE section header row → line item rows → bold `Base subtotal` → `PERFORMANCE GRANT 1` section header → perf row → bold `Totals`. Columns exactly: `Description of Work | Scheduled Value | Previously Billed | This Period | Total Billed to Date | % Complete | Balance to Finish`.
- Reconciliation card per R7.4 (4 rows).
- Button: `Download Summary (Excel)` (reuses m06's `downloadSummary`) — gated like m06 (R4.3); when disabled, an inline line explains: `Blocked — {n} records are missing documents. See Month-End Packet.`

## Acceptance
Every figure equals the Excel for the same data (R10.2); % formats per R1.5; hidden-when-empty settings behave; disabled state explains itself.

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
Bold row: "Base subtotal" $679,916.67 · $483,933.47 · $93,464.96 · $577,398.43 · 85% · $102,518.24
Section header row "PERFORMANCE GRANT 1" (#F1ECE2, bold). Row:
Performance Grant 1         $175,000.00  $39,229.50   $0.00       $39,229.50   22%  $135,770.50
Bold row: "Totals" $854,916.67 · $523,162.97 · $93,464.96 · $616,627.93 · 72% · $238,288.74

Below-left, a reconciliation card (max 460px, bordered white, rows separated by hairlines,
label left / value right):
"Total advances received — $665,000.00"
"Total reconciled to date — $616,627.93"
"Balance remaining to reconcile — $48,372.07"
"Percentage of advance payments reconciled — 93%"

Then a primary button "Download Summary (Excel)".
```
