# Output Spec — Contract Summary Excel

One workbook per **(funding source, month)** (D-93, Phase 6 — that source's own line items and expenses only): `{DocName}_{Month}_{YYYY}_Summary.xlsx` (e.g. `Team_Pursuit_February_2026_Summary.xlsx`), or once the organisation has more than one funding source, `{DocName}_{SourceName}_{Month}_{YYYY}_Summary.xlsx` (R10.3, decision 2.12). Library: **exceljs** (SheetJS community edition cannot write cell styles — prototype used it, we don't). All money cells number format `[$$-409]#,##0.00`, all percent cells `0%`, values written as numbers (dollars, not cents) / fractions (0.66), never preformatted strings. The currency symbol is pinned to en-US rather than written as a bare `"$"`: Numbers and LibreOffice treat a bare `$` as the system currency, which rendered a delivered workbook in Hong Kong dollars.

## Sheet 1 — `Contract Summary`

Column widths (chars): 34, 16, 16, 14, 18, 12, 16.

| Row | Content |
|---|---|
| 1 | Header (bold, fill `FFFF00`, thin black borders): `Description of Work | Scheduled Value | Previously Billed | This Period | Total Billed to Date | % Complete | Balance to Finish` |
| 2 | `BASE` — bold, merged A:G, fill `F1ECE2` |
| 3…n | One row per line item in sort order, figures per R3 for the active month — including one built from performances (R9.5) where applicable; there is no second section. A line item with a performance names it in column A: `{name} (includes {amount} performance)`, next to its combined Scheduled Value in column B |
| n+1 | `Totals` — entire row bold. No separate `Base subtotal` row: every line item is a base row now that the old Performance Grant section (R7.2, retired — D-80) is gone, so a subtotal would only ever repeat this row |
| n+2 | blank |
| n+3 | `Total advances received` (col A) · amount (col B, `[$$-409]#,##0.00`) — R7.4 |
| n+4 | `Total reconciled to date` (A) · amount (B) |
| n+5 | `Balance remaining to reconcile` (A) · amount (B) |
| n+6 | `Percentage of advance payments reconciled` (A) · percent (B, `0%`) |

Table cells (rows 1…n+1) thin black borders; reconciliation rows no borders/fill. Labels column A left, numbers right (Excel default numeric alignment). User-entered text (names, descriptions) is always written as **string cells, never formulas** (formula-injection guard; prefix-escape `=+-@` if a CSV export is ever added).

## Sheet 2 — `{Mon} Detail` (e.g. `Feb Detail`)

Every expense of the month, insertion order grouped by line item (line item sort, then expense sort).

| Col | Header | Width | Content |
|---|---|---|---|
| A | Date | 12 | `M/D/YYYY` |
| B | Name | 24 | expense name |
| C | Line Item | 24 | |
| D | Description | 55 | |
| E | Payment Source | 30 | R5.1 label *(addition vs prototype — decided)* |
| F | Subtotal | 12 | `[$$-409]#,##0.00` |
| G | Tax | 10 | |
| H | Fees | 10 | |
| I | Receipt Total | 14 | subtotal + tax + fees, always (R1.3a) — what the attached document says |
| J | Reimbursable Amount | 18 | subtotal + whichever of tax and fees this expense's flags allow (R1.3) |

Header row: bold, fill `FFFF00`. Final row: `Totals` in D, sums in F–I, bold.

## Gate & acceptance

Blocked while the month has documentation-incomplete expenses (R4.3). Acceptance: figures reconcile exactly with the dashboard and packet page 1 for the same data (R10.2); opens clean in Excel and Google Sheets; the February test reproduces the real packet's summary relationships (Totals equals the base subtotal exactly — R7.2 retired, D-80 — and reconciliation math per R7.4).
