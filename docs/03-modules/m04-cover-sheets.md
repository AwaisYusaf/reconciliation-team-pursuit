# m04 — Cover Sheets

## Purpose
On-screen preview of each line item's Breakdown document exactly as it will print, plus Word/PDF downloads. The preview *is* the trust-builder: what Misty sees here is byte-for-byte what the City receives inside the packet.

## Scope
Route `/r/cover-sheets`, scoped to the header's selected funding source (§14, D-93) — this screen requires one source picked, and shows `PickFundingSource` when "All" is selected. Line item selector (each + All, from that source only), faithful preview per `02-outputs/cover-sheet-spec.md` (its title uses the same document name the file prints: the source's own, else the organisation's — R6.1), `Download Word` / `Download PDF` buttons, gate handling.

## Data
Reads that source's expenses + documents per (month, line item); calls the cover-sheet generator for downloads, passing the source id. Rules R6.*, R4.3, §14.

## Behavior
- Preview renders the document 1:1: title with its brown rule, brown-header Name/Role/Amount table (all cells centered, warm grey grid), tinted total row, canonical see-below line, bold `{Name}:` headings with inline notes in bold brown on a tint (custom + tax note per R6.5), narrative paragraphs, proof images (real thumbnails from S3, contained, full column width). Preview images re-presign automatically on load error (expired URLs) — or are served via the authenticated thumbnail proxy.
- Selector `All line items` stacks every sheet as separate "pages" (bordered white blocks); the global download buttons are hidden and **each stacked sheet carries its own Word/PDF buttons**.
- Gate: if the line item has incomplete expenses, its download buttons are disabled with the R12 `blocked-title-line-item` panel and R4.4 list above the preview; the preview still renders, with dashed placeholder boxes labeled "Proof of payment missing" where proofs are absent (screen only — never in a downloaded file).
- Empty line item: dashed empty state, downloads disabled. With one line item selected, the empty state also says what a cover sheet is (`UI.coverSheetWhatItIs`) and offers an `Add Expense` button to `/r/expenses/new`; in `All line items` mode an empty sheet keeps only the one sentence (usability #41, 2026-09-29).
- **Default line item (usability #40).** With no `?lineItem=` (or an unknown one), the screen opens on the first line item, in sort order, that has an expense this month, else the first line item. Each selector option reads `{name} ({count})`, the line item's expenses this month.
- **What follows the sheet (usability #42).** Under each expense in the preview, a small screen-only line names the attached receipts, then the attached supporting files, that the packet puts after this cover sheet: `In the packet, after this cover sheet: receipt.pdf, check.pdf.` The cover sheet file itself never contains this line (no generator change).

## Server surface
`GET /api/downloads/cover-sheet?month=&lineItem=&source=&format=docx|pdf` (D-93, Phase 6) — `source` is required and verified server-side via `findFundingSource`, a 404 for a missing/foreign id. Generated per spec, cached per R10.4 (scoped, not hashed, by source), pinned on download per R10.6. Filename gains the source name once the org has more than one source (R10.3).

## Acceptance
Preview visually matches the generated PDF for the same data; Word file opens in Word/Google Docs; February Analytical Support reproduction passes (cover-sheet-spec acceptance); gate blocks and lists correctly; per-sheet buttons appear in All mode.

---

## Claude Design prompt

```
Design the COVER SHEETS screen inside the app chrome (month "February 2026", Cover Sheets tab
active).

Controls row: h1 "Cover Sheets", then "Line item" select (value "Analytical Support"; options
include All line items) + two secondary buttons "Download Word" and "Download PDF".

Below, a document preview: a white "page" card (max-width 800px, 40px padding, 1px border)
that mimics a printed US Letter document — inside it use document styling, not app styling:
a clean sans-serif document font (Aptos/Calibri-style), ink text (#211B16).

- Centered bold title: "Team Pursuit February 2026 Analytical Support Breakdown", with a 2px
  #5B3A29 rule under it across the page
- A 3-column table with warm grey (#D8D0C4) 1px borders and ALL cells center-aligned. Header
  row cells have a solid #5B3A29 background and borders, bold white text: Name | Role | Amount. Rows:
  IE Creatives | Environment and tools to support initiatives and events | $3,150.00
  Hi Res Models | Ongoing support of Team Pursuit events with tools and systems to guide and maintain messaging to the community. | $3,500.00
  AB Solutions | Core platform infrastructure setup: initial configuration and foundational backend architecture. | $8,500.00
  Emerald Sims | Contracted to provide analytical and administrative duties in support of Team Pursuit initiatives | $1,360.00
  Mantaq (Kaleem) | Contracted support for the development of a chatbot and web app, plus AI automation integration. | $2,500.00
  HL Pro Tools | Software for team management and analytics | $497.00
  Hiscox | Insurance for Team Pursuit systems and programs | $93.00
  Adobe | Software to support Team Pursuit in a variety of ways including PDF generation and formatting | $99.99
  Shayla Zimmerman | Reimbursed for out-of-pocket purchases in support of Team Pursuit initiatives and events | $190.84
  Final row: first two cells empty, the whole row #F1ECE2 with a #5B3A29 rule above, bold "$19,890.83".
- Paragraph: "Please see below for additional information for some of the above items."
- Then one block per table row, same order, each: bold heading "{Name}:" followed by one or
  two wide light-gray placeholder strips (full width, ~44px tall, 1px border, tiny monospace
  caption "bank transaction crop") representing pasted bank-statement line screenshots.
  Show these fully for: "IE Creatives:" (two strips), "AB Solutions:" (two strips),
  "Hiscox:" (one strip).
- For "Adobe:" show the note style — heading bold, then same-line bold #5B3A29 text on a
  #F1ECE2 background: "(Note: Statement includes tax which was excluded from reimbursement amount)",
  one strip below.
- For "Shayla Zimmerman:" show the narrative style — heading bold, then a plain paragraph
  (no highlight): "Receipts included in packet. Shayla was required to pay out of pocket for
  several things in the course of the month for which she is being reimbursed.", then one
  strip below it.
- End the remaining blocks with a subtle "… continues for every row above" indicator so the
  mockup stays short.

Also design the BLOCKED variant as a second smaller demo above or beside: a red panel (2px
#8A2A22 border on #F6E7E4): bold title "This cover sheet cannot be downloaded yet." + line
"Emerald Sims · Analytical Support · missing proof of payment" with an underlined "Open
expense" link; the two download buttons rendered disabled (gray #C9C2B4 background,
#7A7364 text).
```
