# Output Spec — Cover Sheet ("Breakdown" document)

One per line item per month, generated as **.docx** (canonical) and **.pdf** (converted from the docx — see architecture §generation). Golden references: `context/manual packet/*.docx` and packet pages 31–32, 43–44, 71–72, 94, 99. We match their look while applying the standardizations in domain-rules (R1.2, R6.3, no filler rows). Typography below was verified against the golden docx internals (docDefaults → theme minorHAnsi = Aptos; all table cells `jc=center`) — see review-2026-08-16 A2.

## Page & typography

| Property | Value |
|---|---|
| Page | US Letter portrait, 1" margins |
| Base font | **Aptos 10 pt** (what the golden docs' text actually uses — their `docDefaults` say 11 pt, but every run overrides to 10 pt; see `04-engineering/review-2026-08-20-february.md`), black. In environments without Aptos (the Linux/LibreOffice container) it must resolve to **Carlito**, which is metric-compatible with Calibri. OOXML names one family per run — there is no fallback chain — so this is the container's job, and installing Carlito alone does **not** do it: fontconfig ships Carlito as a substitute for *Calibri*, so Aptos fell through to DejaVu Sans until the image aliased it explicitly (D-78). The Dockerfile fails the build if `fc-match Aptos` does not return Carlito |
| Title | Bold, centered, 12 pt: `{docName} {Month YYYY} {Line Item} Breakdown` (e.g. `Team Pursuit February 2026 Analytical Support Breakdown`) |
| Spacing | Single line spacing; 6 pt after paragraphs; one empty line between title and table |

## Table (immediately after title)

- 3 columns, full text width. Widths: Name 24%, Role 58%, Amount 18%. Fixed layout, so every
  renderer sizes the columns identically rather than to its own font metrics. All borders:
  0.5 pt solid black, all cells.
  - Amount was 15% until D-76. `ROLE_CHARS_PER_LINE` in `page-estimate.ts` is derived from the
    Role width and moves with it.
  - The width was only half the story, and the first explanation for it was wrong. D-76 blamed
    Word rendering wider than our own PDFs; measured in the real container (D-78), the sheets
    were being set in **DejaVu Sans**, a quarter wider per digit than Calibri, because nothing
    aliased Aptos. At 15% that wrapped even a realistic $458,692.46 — which is precisely what
    the client reported. With the alias in place, 18% clears a figure a full digit longer than
    any amount the column can hold.
- Header row: cells shaded `#FFFF00`, text bold, centered: `Name | Role | Amount`.
- Body rows: one per expense in `sort_order`. **All cells centered** (matching the golden docs — Name, Role, and Amount alike). Amounts formatted per R1.2. Cell padding ~4 pt. **No empty filler rows** (manual docs had them; we don't).
- Total row: Name and Role cells empty (borders kept); Amount cell shaded `#FFFF00`, bold, centered = Σ reimbursable of the rows.

## Below the table

1. One blank line, then the canonical sentence (R6.3), regular weight:
   `Please see below for additional information for some of the above items.`
2. For **every** expense, in table order:
   - **Heading paragraph:** bold `{Name} — {reference}:` (D-83; the reference makes the heading unique on the sheet, which the packet's links depend on — a name alone repeats when one person has two pay periods) — followed inline (same paragraph, bold, highlight `yellow`), in R6.5 order: the custom note if set, then the auto tax note whenever `tax > 0` (both print when both apply — D-22), then the no-receipt note per R6.7 if applicable. Example:
     `Kroger: (Note: Statement includes tax which was excluded from reimbursement amount)`
     The note names whatever was actually excluded and is omitted when nothing was (R6.5a).
   - **Narrative paragraph** (if `narrative` set): regular weight, no highlight, full width (R6.6).
   - **Proof images:** each proof (kind=proof, status=attached) in sort order as an inline image, max width = text width (6.5"), height scaled to preserve aspect; PDFs uploaded as proofs are rasterized first at **150 DPI via the shared `raster.ts`** (one image per source page). 6 pt spacing between images, 12 pt before the next heading.
   - Expenses always have ≥1 attached proof in valid output (R4.1/R4.6); the "proof of payment missing" placeholder box exists only in the m04 on-screen gated preview, never in a downloaded file.

Unlike the manual docs, every table row gets its proof block (manual sheets skipped some) and heading names always equal table Names (the heading additionally carries the reference, D-83) — both are deliberate corrections (D-18 family).

## Empty line item (no expenses in month)

The on-screen preview shows `No expenses recorded for {Month YYYY} in {Line Item} yet.` — downloads are disabled for empty line items (nothing to submit). The packet simply omits that section.

## File naming (R10.3)

`{docName} {Month} {YYYY} {Line Item} Breakdown.docx` / `.pdf` — e.g. `Team Pursuit February 2026 Salary Breakdown.docx`. All parts pass the data-model sanitizer.

## Gate

Downloads for a line item are blocked while any of its expenses in the month is documentation-incomplete (R4.3), with the R4.4 listing shown under the `blocked-title-line-item` string (R12).

## Acceptance

Generate the February 2026 Analytical Support sheet from re-entered data and diff against `context/manual packet/…analytical support Breakdown March (1).docx` (structure) + packet pp. 31–32 (visual): identical table shape/colors/alignment (all-centered), identical heading+crop pattern; differences limited to the recorded standardizations (money format, canonical wordings, no filler rows, complete proof blocks). Word and Google Docs both render correctly; the PDF version is visually identical to the docx (D-08 spike); page estimates from `layout-constants.ts` match the real renderer within ±1 page per sheet.
