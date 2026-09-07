# Phase 5 — Packet navigation: clickable references

> In the generated PDF packet, clicking an expense identifier on a cover letter jumps directly to
> the corresponding receipt and proof of payment, removing the need to scroll through a large
> packet searching for supporting documentation.

**Status:** shipped and verified in pdf.js and in Chrome's native viewer. `Last reviewed: 2026-09-07.`

The expense reference (`2026-02-014`, R2.6) is the identifier. Misty is holding July and August
until the city can navigate the packet, so this is on the critical path — but the first thing this
plan establishes is that the hard part is not the links, it is *where the reference is allowed to
appear*.

Everything in §2 was verified by reading the pipeline and by running probes against the real
libraries in this repo, not by assumption. The probes are recorded in §2.4 because the plan's
architecture follows directly from what they proved.

---

## 1. Decisions (taken 2026-09-07)

| # | Decision | Why it matters | Recommendation |
|---|---|---|---|
| **Q1** | **May the reference be printed on the cover sheet, and where?** R2.6 currently forbids it: *"never inside the cover sheet's three-column table, which is the approved layout and neither gains a column nor has its text edited."* The client's ask — *click the identifier on the cover letter* — requires it to be there. | A name cannot be the anchor: two salary expenses for the same person print identical rows and identical headings (§2.4). The reference is the only string that is unique on the page. | **(c)** print it in the body heading — `Jordan Ellis — 2026-02-014:` — which is *outside* the protected table, so R2.6's letter holds and the table the funder approved is untouched; make the table row an invisible click target. If the identifier must be visible in the table itself, **(a)** under the name inside the Name cell, no new column, with R2.6 amended. |
| **Q2** | **One click → where?** Receipt pages and the proof of payment are in different places: receipts are standalone pages after the cover sheet; the proof is embedded *in* the cover sheet under the expense's heading. | A link goes to one place. | Table row and heading → **first evidence page** (receipt, else supporting). Evidence page footer reference → **back to the heading**, which is where the proof sits. One click each way covers "receipt and proof". |
| **Q3** | **Index rows clickable? A printed Page column?** Misty said *"when the PDF is printed"* — links do nothing on paper. | A Page column serves paper; links serve screens. The index's five widths are fixed to exactly 540 pt, so a column is paid for from the others; and index order is by reference, packet order is by line item, so page numbers will not be monotonic. | Yes to clickable Ref cells. Page column: yes if paper matters to the city; expect non-sequential numbers. |
| **Q4** | **PDF outline (bookmark sidebar)?** Summary → Index → each line item → each expense → Month documents. | Costs little once the page map exists; it is the fastest navigation in Acrobat and Chrome. | Yes, as its own phase after links. |
| **Q5** | **Which viewer will the city use?** Acrobat, a browser, or DocuSign's own viewer? | Internal PDF links are standard, but a viewer can ignore them. The client uploads to DocuSign; whether its viewer honours `/Link` → `/Dest` is **unverified** and is not something we can test locally. | Find out before building. The acceptance test is a click in *their* viewer, not ours. |
| **Q6** | **No-receipt expenses (R4.4)** have a row and a heading but zero evidence pages. Where does their link go? | A dead link is worse than none. | Link to the heading (the proof is still there), and index row → the D-74 disclosure line. |

**Decided:**

- **Q1 → (c).** The reference prints in the body heading — `Jordan Ellis — 2026-02-014:` —
  outside the protected table. The table row becomes an invisible click target. R2.6 gains a
  clause naming the heading; the table stays as approved.
- **Q2 →** a click on the row or the heading goes **directly to the first receipt page**
  (supporting page if there is no receipt). The receipt page's footer reference links back to
  the heading, where the proof of payment sits.
- **Q3 →** index Ref cells are clickable. **No printed Page column** — not asked for; can be
  added later without touching the links.
- **Q4 →** yes, a PDF outline.
- **Q5 →** DocuSign's viewer is out of scope. Acceptance is a click-through in Chrome and in
  Preview/Acrobat, plus read-back of the annotations.
- **Q6 →** no-receipt expenses: row and heading link to the heading; the index row links to
  that expense's D-74 disclosure line, which carries the reason.

---

## 2. How the packet is built today, and what that forces

### 2.1 Assembly ([packet-pdf.ts](../src/generation/packet-pdf.ts))

Sections are appended in statement order: summary → index → for each line item: cover sheet, then
each expense's receipts then supporting documents → month documents last (D-77).

- Generated sections (summary, index, **every cover sheet**) enter via `appendGenerated`
  (`:127`): `PDFDocument.load` → **`copyPages`** → `addPage`. The copied page objects are discarded.
- Uploads never go through `copyPages`: each source page is rasterised to JPEG and drawn on a
  fresh `addPage` (`:61-81`). These pages **contain no text** — only the footer stamped later.
- `pageOwners[i]` (`:156`, filled by `owned()` at `:158`) records the expense reference for
  receipt/supporting pages and `null` for everything else. **Cover-sheet pages are not attributed
  to their line item** — `lineItem.id` is in scope at `:183` but never recorded.
- The index is built and appended (`:177`) **before** any evidence page exists, so it cannot know
  page numbers. Page counts of uploads are only certain after rasterisation.

### 2.2 Finishing ([packet-footer.ts](../src/generation/packet-footer.ts), [packet-build.ts](../src/generation/packet-build.ts))

`stampFooters` loads the assembled bytes (`:37`), draws a footer on every page (`:46-50`: 9 pt,
centred by measured width, baseline 0.35" from the bottom), and saves the **same** document
(`:56`). No copy. It already receives `pageOwners` and is the documented "all pages known" stage.
`buildDeliverablePacket` runs assemble → stamp → size check **once per RASTER_LADDER step**
(`:38`), so anything added must live inside that per-step pipeline.

### 2.3 The cover sheet ([cover-sheet-docx.ts](../src/generation/cover-sheet-docx.ts))

Table rows are `Name | Role | Amount` (`:140`); the body prints, per expense, a bold `{Name}:`
paragraph (`:184`), then the narrative, then the proof images (`:250`). **No reference appears
anywhere on the sheet.** `CoverSheetRow` ([cover-sheet.ts:20](../src/domain/cover-sheet.ts)) has no
id or reference — the composer drops identity — although `packet-pdf.ts:184` holds
`SnapshotExpense` with `referenceSeq` at the exact call site. Blocks are tied to expenses purely by
array position. LibreOffice is invoked with default `pdf:writer_pdf_Export` options
([docx-to-pdf.ts:100](../src/generation/docx-to-pdf.ts)).

### 2.4 What the probes proved (pdf-lib 1.17.1, poppler, this repo's own generators)

| Probe | Result | Consequence |
|---|---|---|
| Internal `/Link` annotation + `/Outlines` written with pdf-lib's low-level API, then saved | **Works.** Read back and resolved to the right page. | The library can do it; nothing in the repo uses these primitives yet — first low-level pdf-lib code. |
| Same document: load → draw text on every page → save (exactly what `stampFooters` does) | **Links and outline survive.** | Links may be added at assembly or in the finishing pass. |
| Pages **copied** into a new document with `copyPages` | **Link target breaks** (points at the old document's page); **outline is dropped.** | Links can never be baked into a cover-sheet PDF or the index PDF before merge. They must be added to the **final** document. This rules out docx hyperlinks/bookmarks entirely. |
| `pdftotext -bbox-layout` on a LibreOffice-converted cover sheet | Word boxes in PDF points, per page (y measured from the top). | Anchors can be located *after* conversion; no dependence on LibreOffice's layout being predictable. |
| Two expenses with the same name on one sheet | Two identical rows and two identical `Name:` headings, distinguishable only by y. | **A name cannot be a link anchor.** The reference must be printed (Q1). |
| A reference token, and a footer line, through `pdftotext -bbox-layout` | `2026-02-014` stays **one token** (hyphens do not split it; a trailing `:` rides along). | Anchor matching is a single-word match — no joining of adjacent words. |
| Outline titles via an independent reader (`pdftohtml`) | Readable once written as `PDFHexString` text. | The outline is verifiable by a second tool, not only by pdf-lib reading its own output. |

---

## 3. Architecture

**One principle:** assembly *records* geometry; the finishing pass *draws* everything that needs
the whole document — footers, links, outline — in the single load/save it already performs.

1. **Page map replaces `pageOwners`.** `owned()` records a typed entry per page:
   `{ kind: summary | index | cover | receipt | supporting | month, reference?, lineItemId?, documentId? }`.
   `pageOwners` is derived from it for the footer, so `stampFooters`' contract does not change.
   Additive change to one loop.
2. **Cover-sheet anchors are captured at assembly, before the copy.** When a cover sheet's PDF
   bytes come back from LibreOffice, run `pdftotext -bbox-layout` on *those bytes* and record,
   per expense: the table row's rectangle and the heading reference's rectangle, each with the
   page offset within the sheet. Stored on the page map against the sheet's first packet page.
   The `SnapshotExpense` needed for this is already in hand at `packet-pdf.ts:184`.
3. **Index anchors are captured while drawing.** `drawRow` ([packet-index-pdf.ts:89](../src/generation/packet-index-pdf.ts))
   already computes each cell's rectangle and discards it; return the Ref-cell rects with their
   page-within-section. Translated by the index's first packet page at finishing time.
4. **Evidence-page back-links come from the footer's own geometry.** The finishing pass measures
   the footer with `widthOfTextAtSize` to centre it; the same measurement gives the exact x-range
   of the `2026-02-014` token. The link rectangle and the visible text come from one computation —
   they cannot disagree.
5. **The finishing pass** (`stampFooters` → `finishPacket`) draws footers, adds every `/Link`
   (invisible border, `/XYZ` destination with the target's y so a heading lands at the top of the
   viewport), and writes the `/Outlines` tree. Still one load, one save; still pure on bytes; still
   inside every ladder step.
6. **A new module owns the primitives** — `src/generation/pdf-links.ts`: `addInternalLink`,
   `addOutline`, and `readLinks`/`readOutline` used by tests. Coordinates flip from
   pdftotext's top-origin to PDF's bottom-origin in exactly one place.
7. **`GENERATOR_VERSION` for the packet bumps.** Links are code, not snapshot data; without the
   bump every cached and pinned packet keeps serving the unlinked bytes (R10.4).

What this deliberately does **not** do: touch the docx (no hyperlinks, no bookmarks — proved
pointless by the copy probe); change the funder-approved table beyond Q1; add a dependency
(pdf-lib and poppler are already there; the container already installs `poppler-utils`).

---

## 4. Phases

Each runs through the standing gates: plan → review the plan → implement → review the
implementation adversarially → test in a real viewer → commit.

- **N0 — Decisions and rules.** Answer Q1–Q6. Amend R2.6 per Q1; add a *Navigation* section to
  `packet-pdf-spec.md`; extend `cover-sheet-spec.md` for the reference placement; record the
  decision (D-8x). Nothing else starts until this is written down.
- **N1 — Page map.** Typed page records from `owned()`; cover pages attributed to their line item;
  `pageOwners` derived. Extend `packet-trace.integration.test.ts` to assert the map for every
  page kind. No visible change.
- **N2 — Link primitives.** `pdf-links.ts` with read-back helpers. Unit tests on synthetic
  documents reproduce the probes: survives the stamp cycle; breaks under `copyPages` (a test that
  *documents* the constraint, so nobody moves the pass upstream later).
- **N3 — Anchors** *(done)*. Reference printed per Q1; `locateOnPages(bytes, token)` over
  `pdftotext -bbox-layout`, gated like the other poppler-dependent tests (dev machines on Xpdf
  may lack `-bbox-layout`; the production container has poppler). Tests: single token match with
  trailing punctuation; duplicate names resolve to different rows; heading on page 2 of a sheet.
- **N4 — Links** *(done)*. Cover row → first evidence page; heading → first evidence page; evidence footer
  reference → heading; index Ref → per Q3; no-receipt → per Q6. Bump `GENERATOR_VERSION`.
- **N5 — Outline** *(done, shipped with N4 — the finishing pass writes it from the same map)*.
- **N6 — Verification and hand-off** *(see §8)*. Real-viewer click-through (Chrome, Preview/Acrobat, and the
  city's viewer per Q5), docs, deploy, and *then* Misty records her video — the packet she films
  must be the one the city receives.

---

## 5. Passing criteria

All assertions run against the **stamped deliverable bytes** — the file the city receives — never
against the pre-stamp document. Every criterion covers **every** expense in the fixture, not a
sample.

**Links**
- [x] For every expense with at least one evidence page: the cover-sheet row link and the heading
      link resolve to that expense's first evidence page, as recorded in the page map.
- [x] For every evidence page: the footer's reference token links back to that expense's heading,
      on the correct cover-sheet page, with a `/XYZ` y inside the heading's bounding box.
- [x] For every index row: the Ref cell links per Q3; no-receipt rows behave per Q6. **No link in
      the document has an unresolvable destination.**
- [x] Every link rectangle contains the bounding box of the text it stands for, measured with
      `pdftotext -bbox-layout` on the *final* packet — the click target is where the eye is.
- [x] Two expenses with identical names on one sheet link to **different** targets (the probe
      scenario, made a test).
- [x] A heading on the second page of a multi-page cover sheet resolves to that page, not the
      first.
- [ ] Links are present in **every** RASTER_LADDER step's output, not only the first. *(By construction — `finishPacket` runs inside the per-step loop — but only the delivered step is asserted.)*

**Outline (if Q4 = yes)**
- [x] One entry per section, line item and expense, titles readable by `pdftohtml`, every
      destination resolving to the recorded page.

**Nothing else moved**
- [x] Page count and every footer string are byte-for-byte what they were before the pass.
- [x] Link borders are invisible (`/Border [0 0 0]`, asserted by read-back); the cover sheet's only visible change is the reference in the heading (rendered and inspected in both viewers below).
- [x] The packet's `GENERATOR_VERSION` is bumped (packet-12; cover-8). *Rebuild of a previously pinned artifact not exercised.*

**Guards that can actually fail** (mutation-tested, as every guard in this project must be)
- [x] Remove the link pass → the integration test fails.
- [ ] Swap the order of two expenses in the fixture → every link still resolves to the *right*
      expense. *Not run as a mutation; the duplicate-name anchor test covers the failure mode it targets (two identical rows resolving to different headings by reference).*
- [x] Shift a link rectangle by 20 pt → the "contains the text" criterion fails.
- [x] Add a link before `copyPages` → the N2 test proves it breaks.

**In the world**
- [x] A click on each link type works in a real viewer — **pdf.js: every hop, recorded in §8. Chrome's native viewer: confirmed by a manual click after the `/Fit` finding below.** Preview/Acrobat not driven this session; DocuSign out of scope (Q5).
- [x] Printing is unaffected: the index and the footers remain the paper trail (R2.6, D-70).

---

## 6. Edge cases that must not be missed

- **Names are not anchors** (§2.4). Headings are found by their reference token, which is unique
  by construction. Table rows print no reference (Q1), so they *are* positional — the n-th money
  token in the Amount column is the n-th row — but never by name, and never trusted: the n-th
  token must print exactly the n-th expense's amount or `coverSheetAnchors` throws rather than
  return a wrong link. The generator emits rows in expense order and LibreOffice reads a
  fixed-layout table top to bottom; a mismatch is a regression in one of them.
- **Rasterised pages carry no text.** Their only anchor is the footer, which exists only after
  stamping — which is why back-links belong in the finishing pass and nowhere else.
- **Coordinate systems.** pdftotext measures y from the top; PDF rectangles from the bottom. One
  conversion, in one function, tested against the page height read from the bbox output — never
  the assumed 792.
- **The reference may wrap.** LibreOffice can break `Jordan Ellis — 2026-02-014:` across lines;
  the anchor is the reference token's own box, not the name's.
- **Receipt and supporting documents** are both evidence; "first evidence page" follows
  `packetDocumentsFor`'s existing order (receipts first).
- **The ladder re-runs assembly.** Geometry is recorded per assembly, so a lower-quality step
  cannot inherit stale rectangles from a higher one.
- **Pinned artifacts never regenerate** (R10.6). Packets already delivered stay unlinked; only
  new downloads gain navigation. Say so to Misty.
- **`pdftotext -bbox-layout` at assembly time is a new runtime dependency on poppler**, not only a
  test dependency. The container has it; `render-smoke.ts` should assert the flag is supported.
- **DocuSign** (Q5) is the one thing no local test can settle.

---

## 7. Out of scope, named so it stays out

The Excel workbook; the per-line-item cover-sheet *downloads* (they are single documents with
nothing to link to); changing the index's sort order; and any change to the docx beyond the
reference placement in Q1.

---

## 8. What was verified, and how (N6)

**On the delivered bytes** (`packet-trace.integration.test.ts`, real LibreOffice output, real
storage): four expenses, one without a receipt, proofs that push every heading onto its own
page. Every link resolves; rows and headings land on the first receipt page; every back-link
sits on its footer's reference token; every heading link covers the heading's token; the
no-receipt expense links to its own heading and its index cell to the D-74 line; the outline
reads in packet order. Two mutations bite: finishing without links fails six assertions, moving
heading links twenty points off the text fails the covering check.

**On a real packet** built from the local Team Pursuit data — 93 pages, 156 links, none
unresolved, links on 86 pages, outline of every line item and expense.

**In pdf.js** (Firefox's PDF engine, served with the packet from a scratch directory), driving
its own link-annotation layer: page 4 row → receipt page 7; footer `2026-02-001` → heading page 5
(*"Payroll — Pay Period 1 — 2026-02-001:"*, the duplicate-name case, resolved by reference);
heading → page 7. Each hop is in the viewer's own log and screenshots.

**In Chrome's native viewer** — and the one thing pdf.js did not catch. The first build wrote
whole-page targets (row and heading → receipt) as `/Fit` and positioned targets as `/XYZ`. pdf.js
followed both; Chrome followed only the `/XYZ` ones: the index cells worked, the rows did not.
The raw objects showed no other difference between the two kinds of link. Every destination is
now `/XYZ`, with the page height standing in for a whole-page jump (`a86ff9c`). Confirmed by a
manual click in Chrome: the "Payroll — Pay Period 1" row lands on
*"Team Pursuit — February 2026 — 2026-02-001 — Page 7 of 93"*. The extension's synthetic clicks
never reach the PDF plugin, so this needed a human; automation could only stage it.

**Not verified**: Preview/Acrobat (desktop automation was unavailable this session); a rebuild of
a previously pinned artifact; links on lower RASTER_LADDER steps (present by construction, not
asserted). Worth knowing for the next viewer question: a link a second viewer follows is not proof
a first will — the `/Fit` case passed every automated check. The in-app Browser pane cannot render PDFs at all — it offers a download — which is
why a second viewer was needed.

**Hand-off**: pinned packets from before D-83 stay as delivered (R10.6). July and August become
navigable only if generated after this deploys; Misty's video should be recorded after it.
