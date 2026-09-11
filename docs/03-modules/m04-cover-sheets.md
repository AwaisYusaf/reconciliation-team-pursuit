# m04 — Cover Sheets

## Purpose
On-screen preview of each line item's Breakdown document exactly as it will print, plus Word/PDF downloads. The preview *is* the trust-builder: what Misty sees here is byte-for-byte what the City receives inside the packet.

## Scope
Route `/r/cover-sheets`, scoped to the header's selected funding source (§14, D-93) — this screen requires one source picked, and shows `PickFundingSource` when "All" is selected. Line item selector (each + All, from that source only), faithful preview per `02-outputs/cover-sheet-spec.md` (its title uses the same document name the file prints: the source's own, else the organisation's — R6.1), `Download Word` / `Download PDF` buttons, gate handling.

## Data
Reads that source's expenses + documents per (month, line item); calls the cover-sheet generator for downloads, passing the source id. Rules R6.*, R4.3, §14.

## Behavior
- Preview renders the document 1:1: title, yellow-header Name/Role/Amount table (all cells centered), yellow total cell, canonical see-below line, bold `{Name}:` headings with yellow inline notes (custom + tax note per R6.5), narrative paragraphs, proof images (real thumbnails from S3, contained, full column width). Preview images re-presign automatically on load error (expired URLs) — or are served via the authenticated thumbnail proxy.
- Selector `All Line Items` stacks every sheet as separate "pages" (bordered white blocks); the global download buttons are hidden and **each stacked sheet carries its own Word/PDF buttons**.
- Gate: if the line item has incomplete expenses, its download buttons are disabled with the R12 `blocked-title-line-item` panel and R4.4 list above the preview; the preview still renders, with dashed placeholder boxes labeled "proof of payment missing" where proofs are absent (screen only — never in a downloaded file).
- Empty line item: dashed empty state, downloads disabled.

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
include All Line Items) + two secondary buttons "Download Word" and "Download PDF".

Below, a document preview: a white "page" card (max-width 800px, 40px padding, 1px border)
that mimics a printed US Letter document — inside it use document styling, not app styling:
a clean sans-serif document font (Aptos/Calibri-style), black text.

- Centered bold title: "Team Pursuit February 2026 Analytical Support Breakdown"
- A 3-column table with ALL black 1px borders and ALL cells center-aligned. Header row cells
  have PURE YELLOW (#FFFF00) background, bold: Name | Role | Amount. Rows:
  IE Creatives | Environment and tools to support initiatives and events | $3,150.00
  Hi Res Models | Ongoing support of Team Pursuit events with tools and systems to guide and maintain messaging to the community. | $3,500.00
  AB Solutions | Core platform infrastructure setup: initial configuration and foundational backend architecture. | $8,500.00
  Emerald Sims | Contracted to provide analytical and administrative duties in support of Team Pursuit initiatives | $1,360.00
  Mantaq (Kaleem) | Contracted support for the development of a chatbot and web app, plus AI automation integration. | $2,500.00
  HL Pro Tools | Software for team management and analytics | $497.00
  Hiscox | Insurance for Team Pursuit systems and programs | $93.00
  Adobe | Software to support Team Pursuit in a variety of ways including PDF generation and formatting | $99.99
  Shayla Zimmerman | Reimbursed for out-of-pocket purchases in support of Team Pursuit initiatives and events | $190.84
  Final row: first two cells empty, Amount cell YELLOW background bold "$19,890.83".
- Paragraph: "Please see below for additional information for some of the above items."
- Then one block per table row, same order, each: bold heading "{Name}:" followed by one or
  two wide light-gray placeholder strips (full width, ~44px tall, 1px border, tiny monospace
  caption "bank transaction crop") representing pasted bank-statement line screenshots.
  Show these fully for: "IE Creatives:" (two strips), "AB Solutions:" (two strips),
  "Hiscox:" (one strip).
- For "Adobe:" show the note style — heading bold, then same-line text with PURE YELLOW
  highlight: "(Note: Statement includes tax which was excluded from reimbursement amount)",
  one strip below.
- For "Shayla Zimmerman:" show the narrative style — heading bold, then a plain paragraph
  (no highlight): "Receipts included in packet. Shayla was required to pay out of pocket for
  several things in the course of the month for which she is being reimbursed.", then one
  strip below it.
- End the remaining blocks with a subtle "… continues for every row above" indicator so the
  mockup stays short.

Also design the BLOCKED variant as a second smaller demo above or beside: a red panel (2px
#8A2A22 border on #F6E7E4): bold title "Downloads unavailable for this line item." + line
"Emerald Sims — Analytical Support — missing proof of payment" with an underlined "Open
expense" link; the two download buttons rendered disabled (gray #C9C2B4 background,
#7A7364 text).
```
