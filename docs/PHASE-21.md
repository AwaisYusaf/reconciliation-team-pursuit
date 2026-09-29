# Phase 21: The month-end packet in the app's colours

**Status (2026-10-01): built, rendered and reviewed; rebased onto `main` at 9082903 (branch
`feat/branded-packet`).** Built 2026-09-29 as Phase 20 / D-134; both numbers were taken on `main`
meanwhile (D-134 funding limit, PHASE-20 and D-136 safer receipt reads), so this is Phase 21 / D-137.
Written from the code and from a real render of the local February fixture packet through the
production image's LibreOffice (Aptos aliased to Carlito, D-78). No migration and no new environment
variable. Decision D-137. Amends D-121 ("Everything a funder receives is unchanged").

---

## 1. What this is

The client asked for the final packet to look branded, in the app's theme. Awais, 2026-09-29:

> The theme package does not match the application's theme and design system. [...] I do not want
> to make it a stylish and very colorful PDF because that is mostly used for government purposes.
> We need to keep it as professional as possible. [...] Utilize our application themes on minimal
> fields so that it looks better and not colorful and clunky-styled PDF.

**What the packet is today** (`src/generation/packet-pdf.ts`): the cover sheets, each followed by
its expenses' receipts and supporting files, then the month documents. The contract summary and
the expense index are hidden (D-114). Only two things in it are drawn by the app:

- **The cover sheets** (`cover-sheet-docx.ts`, a Word file converted to PDF). Their look copies the
  client's hand-made February documents: a pure yellow (`#FFFF00`) header row and total cell,
  yellow-highlighted notes, a 0.5 pt black grid, black text.
- **The footer** on every page (`packet-footer.ts`): Helvetica 9 pt, grey `#787878`.

Everything else is an uploaded receipt, proof or statement, drawn as an image.

After this phase the same pages use the app's palette in a few places only: a brown rule under the
title, a brown header band, and a light tinted total row under a brown rule. Notes lose the neon
yellow for brown text on the same quiet tint. The words, columns, fonts, sizes and alignment do
not move; the title rule adds 7.5 pt above the table.

---

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| Q1 | **No logo.** Colours only; no Stay Funded 360 mark on any page | Awais, 2026-09-29 (a footer wordmark was drafted and declined). The packet stays the organization's document |
| Q2 | **No title page.** The packet still starts at the first cover sheet | Awais, 2026-09-29. Keeps D-114's start, the page count and the packet screen unchanged |
| Q3 | **The table stays all-centered** | Awais, 2026-09-29. The change is colours; the funder-approved layout keeps its shape |
| Q4 | Brown marks four things: the title rule, the table header, the total row's rule and the note text | "Minimal fields". Everything else stays ink on white, so it prints and photocopies cleanly |
| Q5 | The header band is flat `accent`, not the app's gradient | Word cannot fill a cell with a gradient, and a flat fill prints evenly |
| Q6 | Notes keep their emphasis: bold, `accent` brown, on the `section` tint | They carry the tax and no-receipt disclosures (R6.5, R6.7); they must still stand out |
| Q7 | Text, columns, widths, font, sizes, alignment and every spacing value are unchanged; the one addition is the title rule, 7.5 pt above the table | D-76 and D-78 calibrated the widths to Carlito at these sizes; the anchors (D-83) read the same words |
| Q8 | The standalone cover sheet downloads (.docx, .pdf) and the on-screen preview change with the packet | One builder serves all three, and the preview promises a 1:1 match (m04) |
| Q9 | The hidden summary and index sections take the same palette | So they match the cover sheets if they come back (D-114). Today the summary's header is yellow with a black grid and an unfilled total; the index header is already the `section` tint on a `line` grid. Both gain the brown band and a title rule, which moves their tables a few points down (Q7 is about the cover sheet) |
| Q10 | The Excel summary keeps its yellow | Not part of the packet; not asked for |

**Palette** (`app/globals.css` tokens, one supplier in `src/generation/document-theme.ts`):

| Where | Token | Value |
|---|---|---|
| Body text | ink | `#211B16` |
| Footer text | sub | `#5B5147` |
| Grid lines | line | `#D8D0C4` |
| Title rule, header band, total rule, note text | accent | `#5B3A29` |
| Total row fill, note background | section | `#F1ECE2` |

---

## 3. Changes

1. **`src/generation/document-theme.ts`** (new): `DOCUMENT_THEME` (the five colours as bare hex, for
   Word) and `channels(hex)` (for pdf-lib's `rgb()`). The one supplier for every generator and the
   preview.
2. **`src/generation/cover-sheet-docx.ts`**:
   - Title: same text and size, with a 1.5 pt `accent` bottom border 6 pt below the text.
   - Header row: `accent` fill, `accent` borders, bold white text.
   - Body grid: 0.5 pt `line` instead of black.
   - Total row: all three cells `section` fill, a 1 pt `accent` rule on top; Name and Role stay
     empty; the amount stays bold.
   - Notes: no highlight; bold `accent` text with a `section` run background.
   - Default run colour `ink` instead of black.
3. **`src/generation/packet-footer.ts`**: footer colour `sub` instead of `#787878`. Text, size,
   position and the reference back-links are unchanged.
4. **`src/generation/packet-summary-pdf.ts`** (hidden): the yellow header → `accent` band with white
   text; the unfilled totals row → `section` fill under an `accent` rule; black grid → `line`; text
   `ink`.
   **`src/generation/packet-index-pdf.ts`** (hidden): header fill → `accent` band with white text;
   grid → `line`; text `ink`.
5. **`src/generation/page-estimate.ts`**: `TITLE_PX` grows by the rule (1.5 pt + 6 pt ≈ 10 px), so
   the packet screen's estimate moves with the renderer. Measured: the rendered table moved down
   8 pt (the row links went from y 645 to 637); the model adds 7.5 pt.
5a. **Body cells draw no top border** (`nil`); the row above supplies the edge. Found by rendering:
   the header's brown bottom edge and the first row's grey top edge are the same width, and
   LibreOffice (7.4 in the container, 26.2 on a Mac) drew the grey as a hairline under the band,
   where Word keeps the darker colour. With one edge there is no tie.
5b. **`src/generation/layout-constants.ts`**: `COVER_COLUMN_SHARES` (24/58/18), read by the Word file
   and the preview. The preview still had its own pre-D-76 24/61/15 split; it now cannot drift.
5c. **`src/generation/pdf-grid.ts`** (new): `strokeOpenTop` draws a pdf-lib body cell's left, right
   and bottom edges only. The hidden summary and index drew a full grey rectangle per cell, whose
   top edge painted the same hairline over their brown band (found by the implementation review).
5d. **`onAccent`** in `DOCUMENT_THEME` (the app's `surface`, white): the band's text colour, written
   once instead of three literals.
6. **`app/r/cover-sheets/cover-sheet-preview.tsx`**: the same styling, read from `DOCUMENT_THEME` as
   inline styles, so the preview and the file cannot drift. The now-unused `--color-doc-yellow`
   token leaves `app/globals.css`.
7. **`src/generation/versions.ts`**: bump `COVER_SHEET_GENERATOR_VERSION` and
   `PACKET_GENERATOR_VERSION`. Pinned artifacts stay as delivered (R10.6); unpinned ones rebuild.
8. **Docs**: D-137; `cover-sheet-spec.md` (table, notes); `packet-pdf-spec.md` (footer colour, the
   hidden sections' look); `domain-rules.md` R6.5 and R6.7 ("yellow-highlighted" → "highlighted");
   `m04-cover-sheets.md` (preview and its Claude Design prompt); `design-language.md` (the
   doc-yellow row and the preamble's "Pure yellow" line); `src/domain/cover-sheet.ts`'s note
   comment; this file; the README row.

---

## 4. Edge cases

| Case | Expected |
|---|---|
| A table longer than one page | The brown header band repeats on every page (`tableHeader`), as the yellow one did |
| Printed or photocopied in black and white | Header reads as dark grey with white text (white on `accent` ≈ 10:1); tint as a light grey; notes as dark grey on light grey |
| A note, a tax note and a no-receipt note on one heading | Each prints with the tint, same order as before (R6.5) |
| A narrative under a noted heading | Narrative stays plain: no tint, no colour |
| Anchors and links (D-83) | Unchanged: the words "Role", "Amount", the amounts and the `(reference):` tokens print as before |
| Page count | The same for every sheet unless the 10 px title rule tips a sheet over a page boundary; the estimate accounts for it |
| Opened in Word or Pages | Cell fills, the title border and the run background are standard OOXML and render there as in LibreOffice |
| A month already downloaded (pinned) | Its stored file is kept as the record (R10.6), and a share link keeps serving it until someone presses Update. But the version is part of the cache key, so pressing Download for **any** month, including submitted or signed ones, now builds a new file in the new colours. Every earlier generator bump has worked the same way. Tell the client |
| A table that breaks across pages | The repeated header's brown edge tops the first row of each page, as on page one (no body cell has a top edge of its own) |

---

## 5. Tests and checks

**Tests** (each fails with the mutation named; all mutations were run):

| Test | Mutation that fails it |
|---|---|
| `cover-sheet-docx.test.ts`: header cells filled `accent`, bold white labels | Fill back to `FFFF00` |
| same: every cell bordered 0.5 pt in `line`, no `000000` | Grid back to black |
| same: the whole total row `section`, under a 1 pt `accent` rule | Only Amount filled; the rule removed |
| same: body cells carry a `nil` top edge | (guards 5a) |
| same: notes tinted and brown, the heading's name plain; narrative untinted | `highlight: "yellow"` restored; tint put on the heading |
| same: no `FFFF00` and no `w:highlight` anywhere | Any yellow left behind |
| same: the title paragraph's `accent` bottom border | Border removed |
| `cover-sheet-render.test.ts` (new): converts a real sheet with LibreOffice, rasterises it at 300 DPI and reads pixels located by the sheet's own words: the band is brown, fewer than 2 grid-grey pixels within 3 pt under it (one is a half-covered edge pixel, a drawn line is two or more), the total row tinted, the note tinted while the name's space stays white, a brown rule under the title, the anchors still resolve beside a tinted note, and a 60-row sheet keeps the band's edge brown on every page its header repeats on | Each colour mutation above, and the old grey top edge (fails the one-page and the many-page checks); run against LibreOffice 7.4.7 (production's) and 26.2 |
| same file: the hidden index (60 rows, two pages) and summary, drawn by pdf-lib: brown band, no grey under it on any page | Full grey rectangles restored in either section |
| `document-theme.test.ts` (new): the palette equals the `app/globals.css` tokens; the preview imports it and the column shares, and hardcodes no colour | Accent changed in CSS only; `bg-[#FFFF00]` restored in the preview |
| `scripts/render-smoke.ts`: the smoke sheet's heading now carries the tax note, so the container's deploy gate anchors beside a tinted note | n/a (run in the container: all checks pass) |

The first version of the render test's "no grey line" check passed with the old grey edge restored:
it stopped at the first white pixel, and LibreOffice leaves one anti-aliased white pixel between
the band and the hairline. It now reads a fixed 3 pt window below the band, and fails with the old
edge on both LibreOffice builds.

**Checks run** (after the rebase, 2026-10-01): `npm run typecheck`, `npm run lint`, `npm run
build` (all clean); the render tests (`cover-sheet-render`, `docx-to-pdf`, `pdf-anchors`, 21 tests)
and `scripts/render-smoke.ts` on LibreOffice 7.4.7 in Docker, all passing; the February packet
rebuilt, 90 pages. The full suite in the worktree: 11 failures, all in sign-up and the two AI read
routes, and the same 11 fail on `main`'s own code (9082903) in a worktree: those tests read
`.env.local` from the working directory, which a worktree does not have (secrets are never
copied), so they see sign-ups closed and the AI routes switched off. Before the rebase,
`src/generation` and `src/domain` ran 49 files and 731 tests, none skipped.

**Render results** (February fixture, 39 expenses, through the production image):

| Check | Before | After |
|---|---|---|
| Pages | 90 | 90 |
| Text on every page (pdftotext, page by page) | | identical |
| Links / outline entries | 117 / 46 | 117 / 46; the 39 table-row links point at the same pages, 8 pt lower |
| Hidden summary and index | rendered once, both styled; the index's last row moved to page 2 | |
| Cover sheet .docx in Quick Look (second renderer) | | band, tinted total, tinted notes and title rule shown. Quick Look draws every border black and ignores fixed widths, for the old file as well |
| On-screen preview, `/r/cover-sheets` (local Mantaq, August 2026) | | band, rule and tinted total as in the file; columns measured 23.9 / 57.9 / 18.0 % |

**LibreOffice 7.4 image.** Midway, Docker Desktop stopped and came back with an empty image store,
so the local `reconciliation:localtest` image was gone. The final render checks ran on
`reconciliation-docs:local`, built from the first stage of this repo's `Dockerfile` (the same
Debian, LibreOffice 7.4.7.2, and the Aptos to Carlito alias), all 9 passing.

**Not verified:** Word and Google Docs (neither is available here, and uploading the file to
Google would publish it). The note tint in the browser preview: no local expense in the signed-in
organization has a note; it reads the same `DOCUMENT_THEME` values as the verified cells, and
`document-theme.test.ts` guards the source.

---

## 6. Not part of this

- A logo or wordmark anywhere in the packet (Q1), or a title page (Q2).
- Left or right alignment in the cover sheet table (Q3).
- The Excel summary's colours (Q10), and the monthly summary Word document (Phase 11).
- The cover sheet anchor failure on image-only pages (found while rendering this phase; its own task).
- `scripts/sample-reference-footer.ts`, which draws the footer proposal sample sent to the funder in
  its grey of the time: a record of that proposal, not the packet.
- `ROLE_CHARS_PER_LINE` in `page-estimate.ts` stays hand-derived from the 58% Role share.

---

## 7. Rollback

Revert the commit. Bump both generator versions again, so the cached packets and sheets rebuild in
the old style.

---

## 8. Review

**Plan review** (a separate agent, before the build) found, and this phase took:
- the grey hairline under the band in LibreOffice (5a), then proven by pixel reads;
- no render check drew a tinted note or anchored beside one: `cover-sheet-render.test.ts` and the
  smoke sheet's note;
- the pinned-artifact edge case was wrong (§4 corrected);
- the hidden sections were misdescribed (Q9 corrected), stale comments in `cover-sheet-docx.ts`,
  and docs the plan missed: the spec's black text, title and Acceptance lines, `redesign-brief.md`,
  and D-121, now marked superseded for its colours.

It confirmed the two version bumps are the only caches that embed the cover sheet, that anchors
read white text, that run `shading` (not `highlight`, sixteen named colours) is the only way to get
the tint in Word, and that no tour, help or landing copy mentions yellow.

**Implementation review** (a second agent, on the finished diff) found, and this phase took:
- the summary and index still drew the grey hairline under their band (5c), now pixel-tested;
- `cellProperties()` could return an empty list and pass the header and `nil` checks: the helper
  now asserts 15 cells, and the header's own brown bottom edge is asserted;
- the render check could trip on a half-covered edge pixel: it now needs 2 or more grey pixels;
- no many-page check: the 60-row sheet (it also confirmed `nil` works under repeated headers in
  LibreOffice 26.2; this phase confirmed it in 7.4.7);
- wording that contradicted the code (spacing, the brown note text, the summary's old total),
  a typo in m04, the `vitest.config.mts` name, and white written three times (`onAccent`).
It confirmed the preview is a server component that imports only pure modules, and that CSS
border-collapse gives the tie to the upper cell, so the preview already showed brown under the band.
