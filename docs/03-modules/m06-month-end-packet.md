# m06 — Month-End Packet

## Purpose
The month's finish line: readiness per line item, the blocking list, month-level document uploads, and the two big downloads (packet PDF, summary Excel).

## Scope
Route `/r/packet`. Readiness table · blocking panel · month documents manager · packet contents preview with live page counts · downloads.

## Data
Reads everything for the month; writes `month_documents`. Calls packet + Excel generators (`02-outputs/packet-pdf-spec.md`, `summary-excel-spec.md`). Rules R4.3–R4.4, R11.2–R11.3.

## Behavior
- **Deleted-items safeguard** (only when something was deleted from this reporting period): a panel above the blocking panel lists every expense soft-deleted from the active month — name, line item, amount, deleted-on date — each with an inline `Restore`. Both download buttons stay disabled until the user checks "Yes, these deletions were intentional," independent of and in addition to the documentation gate below. The confirmation is not persisted — it resets on the next page load, so it is re-asked each time someone is actually about to download, not answered once and forgotten. A month with nothing deleted shows no panel and needs no confirmation, same as before this existed.
- **Blocking panel** (only when incomplete records exist): red panel, R12 `blocked-title` + `blocked-intro` strings, then one row per record in the R4.4 template — one combined list covering all three gap types (proof, receipt, narrative) rather than separate lists per type — with an `Open expense` link to m02 edit. Both download buttons disabled while present.
- **Readiness table:** `Line Item | Amount This Month | Records | Documentation Complete` (Yes / red bold No) + Grand Total row (Σ amount, Σ records). **All** line items appear — zero-record rows show `$0.00 · 0 · —`.
- **Zero-expense month:** downloadable (summary + month documents only) with the notice `This month has no expenses.`
- **Submitted flag (R10.6):** after a successful packet download, a quiet `Mark as submitted` action appears; once set, the month shows `Submitted {date}` here and edit warnings elsewhere.
- **Month documents manager:** card listing uploads grouped by category (`Bank statement · Timesheet · Combined hours · Fiduciary invoice · Other`), each row: filename, optional title, page count, Remove. Add flow: category select + optional title + file. Soft reminder (not blocking) when no bank statement uploaded: `No bank statement attached for {Month} yet.`
- **Packet contents, in submission order:** numbered list with live page counts (uploads use stored `page_count`; cover sheets estimated via `layout-constants.ts` per packet-pdf-spec): `1. Contract summary sheet — {n} page(s)`, `2. Expense index — {n} page(s)`, then `{Line Item} — cover sheet + documents — {n} pages` per non-empty line item, and last `Month documents — {n} pages`; total row `Total: {N} pages`. The rows are **rendered from `packetContents`**, the same declaration `buildPacketPdf` assembles in — not a second hand-written list (R11.2, D-77).
- **Downloads:** primary `Download Packet (PDF)` + `Download Summary (Excel)`; generation is a synchronous streaming request behind a single-flight lock (packet-pdf-spec §Failure handling) with an indeterminate "Assembling…" state; post-download toast with file size (artifact pinned per R10.6); if the final size > 25 MB show the compression warning per packet spec; on failure, the red failure panel with Retry.

## Server surface
`presignMonthDocUpload` (quota-checked), `attachMonthDocument(docId)`, `deleteMonthDocument`, `getPacketReadiness(month)`, `downloadPacket(month)`, `downloadSummary(month)`, `markMonthSubmitted(month)`.

## Acceptance
Blocking list matches m03's strip exactly and uses R4.4 wording verbatim; downloads enabled the moment the last missing doc is attached; page counts within ±2 of the generated PDF; generated files match their specs; a 130-page month generates ≤ 60 s; double-click produces one generation run; a month with no deletions shows no deleted-items panel and downloads are gated by the documentation blocking list alone; a month with deletions blocks both downloads until the confirmation checkbox is checked, restoring an item updates the list in place without a full page reload, and the confirmation is not remembered across a fresh page load.

---

## Claude Design prompt

```
Design the MONTH-END PACKET screen inside the app chrome (month "March 2026", Month-End
Packet tab active).

h1 "Month-End Packet", subtext "March 2026".

1) BLOCKING PANEL at top (2px #8A2A22 border, #F6E7E4 background): bold red title "This
packet cannot be downloaded yet." · line "The following records are missing a
receipt/justification or proof of payment:" · three rows separated by hairlines, each with
text left and an underlined "Open expense" link right:
   "Stock Media — Promotional & Marketing — missing proof of payment"
   "JDS Silkscreen & Embroidery — Promotional & Marketing — missing both"
   "Cornelius Webb — Salary — missing proof of payment"

2) READINESS TABLE: uppercase headers Line Item | Amount This Month | Records | Documentation
Complete. Rows:
   Salary $45,641.12 · 9 · No (bold red)
   Analytical Support $19,890.83 · 11 · Yes
   Promotional & Marketing $11,851.65 · 11 · No (bold red)
   Social Services & Support $11,047.74 · 15 · Yes
   Community Programs & Events $4,251.28 · 3 · Yes
   Professional Development $1,599.00 · 2 · Yes
   Grand Total row bold: $94,281.62 · 51.

3) MONTH DOCUMENTS card: h2 "Month documents", helper "Bank statements, timesheets and other
documents that belong to the whole month. They are included at the end of the packet."
Grouped rows:
   BANK STATEMENT — "chase-business-march-2026.pdf" · 11 pages · Remove
   COMBINED HOURS — "combined-hours-march.pdf" · 1 page · Remove
   TIMESHEET — "timesheets-all-staff-march.pdf" · 17 pages · Remove
   FIDUCIARY INVOICE — "dcc-invoice-1750.pdf" · 1 page · Remove
   Add row: category select + "Title (optional)" input + file button.

4) PACKET CONTENTS table: headers # | Item | Pages. Rows: 1 Contract summary sheet 1 ·
2 Expense index 2 · 3 Salary — cover sheet + documents 21 · 4 Analytical Support — cover
sheet + documents 14 · 5 Promotional & Marketing — cover sheet + documents 26 · 6 Social
Services & Support — cover sheet + documents 24 · 7 Community Programs & Events — cover
sheet + documents 8 · 8 Professional Development — cover sheet + documents 4 · 9 Month
documents 30 · bold total row "Total: 130 pages".

5) Buttons row: "Download Packet (PDF)" and "Download Summary (Excel)" — both rendered in
the DISABLED state (gray #C9C2B4 background, #7A7364 text, not-allowed cursor) since the
blocking panel is present.
```
