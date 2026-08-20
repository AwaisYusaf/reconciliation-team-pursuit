# The February test — cover sheet conformance

The acceptance test in `02-outputs/cover-sheet-spec.md`: generate the February 2026 Analytical
Support sheet and diff it against the client's approved one.

Nothing from `context/manual packet/` is reproduced here. Only structural facts are recorded —
page geometry, table shape, colours, alignment, font metrics — never row contents.

## Method

Both `.docx` packages were unzipped and the same facts extracted from `word/document.xml`,
`word/styles.xml` and `word/theme/theme1.xml`. Ours was generated through the real pipeline
(`loadMonthSnapshot` → `coverSheetRows` → `loadProofImages` → `buildCoverSheetDocx`) from the
development fixture, since the client's real February figures are not entered (D-13).

## Matched exactly

| Property | Both |
|---|---|
| Page | 8.5 × 11 in, portrait |
| Margins | 1 in on all four sides |
| Tables | one |
| Columns | three |
| Header shading | `FFFF00` |
| Cell alignment | centered, every cell |
| Borders | same weight and colour |

## Differences

### 1. Body text is 11 pt where the approved document is 10 pt — needs a decision

The spec says **"Base font: Aptos 11 pt (the golden docs' theme default)"**, and the generator
implements exactly that (`BODY_SIZE = 22` half-points).

The parenthetical is accurate and misleading at the same time. The golden document's
`docDefaults` really does say `<w:sz w:val="22"/>` — 11 pt. But no text in it inherits that
value: **every run overrides to `w:sz="20"`, 10 pt**, with 24 (12 pt) for the title. The 11 pt
default is a value the document never uses.

So the spec took the document's default rather than its text, and our sheets render one point
larger than the document the City approved. It is visible, it makes the table taller, and it
can move where a sheet breaks across pages.

Nothing in the spec's list of deliberate standardizations covers typography — those are the
money format (R1.2), canonical wordings, no filler rows, and complete proof blocks. The
instruction otherwise is "we match their look". On that reading 10 pt should win.

**Not changed, because it alters a client-facing document's appearance and the spec states 11 pt
explicitly.** Recommendation: change `BODY_SIZE` to 20 and correct the spec's justification.

### 2. Table width — the standardization, working as intended

| | Client | Ours |
|---|---|---|
| Total width | 7.70 in | 6.50 in |
| Split | 20 / 65 / 13 % | 24 / 61 / 15 % |

The client's table is 1.2 in wider than the text column it sits in, overhanging the right
margin. The spec calls for "3 columns, full text width. Widths: Name 24%, Role 61%, Amount 15%",
which is precisely the correction. Working as specified; no change.

### 3. Theme font — a difference in how, not what

The client's document sets no run font and inherits `minorHAnsi` → Aptos from `theme1.xml`.
Ours names `Aptos` directly on every run and in `docDefaults`, and ships no theme part. Both
resolve to Aptos, and naming it outright survives a converter that ignores or lacks the theme —
which matters, because the deployment container renders these with LibreOffice.

The spec's wording, "The docx references the theme font", describes the client's document
rather than ours. The fallback chain it specifies (Aptos → Calibri → Carlito) is unaffected.

### 4. Inline image count — data, not format

16 in the client's sheet against 8 in ours: their real February expenses versus the fixture's.
Not comparable until D-13.

## Still blocked

The numeric and visual half of this test cannot run yet.

- **The figures are not entered.** Production carries the February packet's line-item values as
  placeholders (D-13); the individual expenses behind them are not in the system. Until they
  are, no generated total can be compared to an approved one.
- **The approved packet is rasterized.** 131 of its 133 pages carry no extractable text, so the
  packet-level comparison can only ever be visual — page-by-page against a render of ours. It
  cannot be automated as a text diff, and that is a property of the source file, not a gap in
  our tooling.

What this test did establish is that the container of the numbers is right: page, margins,
table, colours and alignment all match, with the two differences understood and one of them
recorded above for a decision.
