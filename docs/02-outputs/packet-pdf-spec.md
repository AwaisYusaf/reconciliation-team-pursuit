# Output Spec — Month-End Packet PDF

The single merged, ordered, page-numbered PDF the org uploads to DocuSign. `{DocName}_{Month}_{YYYY}_Packet.pdf`. US Letter portrait throughout. Golden reference: the approved 133-page February packet — we keep its substance, replace its hand-assembled ordering with the canonical order below (client approved defining our own layout).

## Canonical section order

| # | Section | Source |
|---|---|---|
| 1 | **Contract summary section** | Generated (vector text): title `{docName} — Contract Summary — {Month YYYY}`, one subtitle line with the R7.3 context (`Contract {number} · Contract total: {amount} · Base PO {n} · Performance PO {n} · Invoice period {R2.4}` — empty values omitted; `Contract total` includes every line item's performance total on top of a configured contract value, same as the screen and the Excel), the 7-column table (BASE rows → Totals — no separate subtotal or performance grant section, retired R7.2/D-80) matching summary-excel sheet 1, then the 4 reconciliation lines. A line item with a performance names its own name cell `{name} (includes {amount} performance)`, growing the row to fit rather than a new column. Yellow header fill, black grid — same visual family as the Excel. May paginate when line items overflow one page. |
| 2 | **Expense index** | One row per expense in reference order: `Ref · Date · Name · Line Item · Reimbursable`, drawn as vector text. A contents page, so a reviewer holding a receipt can find what it belongs to and a reference quoted in an email names something the packet defines (R2.6). Repeats its column header on every page. Prints "This month has no expenses." rather than being skipped, so a section the contents claims always exists. |
| 3…n | **One section per line item** (line item sort order, skipping line items with no expenses that month): cover sheet pages first (exact cover-sheet-spec content), then per expense in cover-sheet order: receipt/justification files, then supporting documents — all in upload order (`expense_documents.sort_order`); supporting type labels don't affect ordering. |
| last | **Month documents** | Each `month_documents` file, category order: bank_statement → combined_hours → timesheet → fiduciary_invoice → other; within category by sort_order. **This ordering is the authority R11.2 references** — UI groups mirror it. Placed last (D-77): month-level backup sits behind the claim it supports, so the packet opens on the summary and the cover letters rather than on a bank statement. |

The section sequence is declared once, in `packetContents` (`src/generation/packet-order.ts`).
`buildPacketPdf` assembles in that order and the Month-End Packet screen renders from it, so the
listing the user reads and the file they download cannot disagree (R11.2).

Proof-of-payment images appear **only** inside cover sheets (R11.3) — never duplicated as standalone pages. This preserves the manual packet's information while removing its duplication (the 30 pages of payee screenshots at the back of February's packet become salary proofs on the Salary cover sheet, or month/supporting docs if the org still wants them full-page).

## Rendering uploaded documents

- **PDF uploads:** each page rasterized at **150 DPI**, one packet page per source page, centered, scaled to fit within margins (0.5"), aspect preserved. (No contact-sheet compositing in MVP — reviewers read receipts; a compact mode can come later.)
- **Image uploads:** one image per packet page, centered, fit within margins, never upscaled beyond 100%.
- Encoding: JPEG quality ~80 inside the PDF. Generated pages (summary, cover sheets) stay vector text — selectable, tiny.

## Page numbering & footer (R10.5)

Every page, including section 1: `{docName} — {Month YYYY} — Page {i} of {N}`, 9 pt gray (#787878), bottom-center, 0.35" from bottom. Stamped after assembly so N is final.

**Pages documenting one expense also carry its reference**, inserted before the page number
(D-70, funder-approved):

| Page | Footer |
|---|---|
| Summary, index, month documents, cover sheet | `{docName} — {Month YYYY} — Page {i} of {N}` |
| A receipt or supporting document | `{docName} — {Month YYYY} — {reference} — Page {i} of {N}` |

Same position, size and colour — the reference is added to the existing line, not a new mark on
the page. Ownership is collected during assembly, because once pages are merged nothing about a
rasterised receipt says which expense it came from. A cover sheet covers a whole category, a bank
statement the whole month, and the summary and index neither, so none of them carry one. **Proof
of payment is not stamped**: it is embedded in the cover sheet directly under its expense's own
heading, where it is already labelled.

This is what makes the packet self-navigating in both directions — index → evidence, and evidence
→ claim — which is the goal the funder set: *"if a fiduciary, funder, auditor, or organization
reviews the packet, they should be able to follow the financial trail without needing someone to
manually explain where the documentation is located."*

## Size & compatibility

- Target ≤ **25 MB** (DocuSign envelope ceiling). If a build exceeds it: rebuild at 120 DPI / JPEG 70; still over → one final step at 100 DPI / JPEG 60, then **deliver anyway** with a warning stating the final size and that DocuSign may reject it — never block the download on size. February's manual equivalent was 25 MB at 133 pages — we expect to land well under with JPEG.
- Normal single-file PDF 1.7, no encryption, no forms — DocuSign-uploadable as-is. Signature happens outside the system.

## Failure handling

Uploaded files are validated at attach time (data-model §Upload processing), so packet-time failures are exceptional. If any step fails (soffice non-zero exit, rasterization error, wall-clock timeout), the user gets a red panel — `Packet generation failed at {section/file}` — with a Retry button; the error is logged server-side with the failing artifact id; a partial packet is **never** served. Generation runs under a per-(org, month, type) single-flight lock — a second concurrent request waits and receives the first run's result.

## Gate

Download blocked while any expense of the month is documentation-incomplete (R4.3/R4.4). Month documents are **not** gated (they're optional uploads), but the packet screen shows a soft reminder if no bank statement is attached for the month. A month with zero expenses is downloadable (summary + month documents only) with a notice: `This month has no expenses.`

## Packet screen contents listing

The Month-End Packet screen lists the sections in this exact order with live page counts and a grand total — replacing the prototype's hardcoded "approximately 130 pages". It renders from `packetContents`, the same declaration the assembler uses, so "in the order the funder will read them" is a fact rather than a promise kept by hand (D-77). Uploaded files contribute their stored `page_count`; cover sheets are estimated from `layout-constants.ts` (first-page table-row capacity + Σ ceil(scaled proof-image heights ÷ usable page height), using stored image dimensions) — the same constants the real renderer uses, keeping estimates within ±2 pages.

## Acceptance

The February test: re-entered February 2026 produces a packet whose sections contain everything the approved packet contained (summary figures, all cover sheets with crops + notes, all receipts, statements, timesheets, fiduciary invoice), ordered per this spec, correctly numbered, ≤ 25 MB, accepted by Misty as submittable.
