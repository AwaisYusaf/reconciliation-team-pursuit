# Phase 20: Safer receipt reads

**Status (2026-10-01): built, unit-tested and checked with the real model (branch
`fix/safer-receipt-reads`).** Asked for by Awais on 2026-10-01: "test the PDF receipt extraction on
blurred PDFs, a file with more than one item so it adds and show a combined expense." Decision
D-136. No migration, no new environment variable.

---

## 1. What we found (real model, 3 runs per file)

One restaurant receipt (16 items, total 204.75), as a PDF and as a phone photo: clear, lightly
blurred, medium blur, heavy blur and low resolution.

| Finding | Before | After |
|---|---|---|
| Read cut off: the model's reasoning used the whole 600-token allowance, so the read failed | about half the photo reads, once on the clear photo | none |
| Unreadable photo returned made-up amounts (84.74, 24.75 for a 204.75 receipt) | yes | declines instead |
| Numeric date order (02/09/2025) | random | month/day/year |
| Light blur: subtotal and tax a few cents off, total right | yes | still happens |
| Made-up vendor when the logo is a script font | yes | still happens, accepted: the person checks every suggestion before Add |

**A receipt with many items already works.** The reader takes the printed total, and the
16-item receipt read 204.75 on every clear read. Picking items, and adding up receipts with no
printed total, were considered and dropped (2026-10-01): a real receipt prints its total, and
one receipt is one expense.

---

## 2. The change

`src/services/openai/read-amounts.ts`:
1. Output cap 600 → 2000 tokens. The model's reasoning counts against it (Phase 19 P4 raised it
   to 600 for the same reason).
2. Photos are sent with `detail: "high"`, so OpenAI does not shrink a small receipt photo before
   reading it.
3. Prompt: when any digit of an amount can't be read with certainty, answer `found: false`;
   the vendor comes from the header, logo or footer, never an item name; a numeric date is
   month/day/year.

`src/services/openai/read-invoice.ts` (sibling: same photo handling, same "never guess"
prompt): changes 2 and 3. Its cap is already 4000.

4. `src/services/openai/prepare-photo.ts`, used by both readers: a JPEG or PNG under 1500px on
   the long side is enlarged to 2000px, made grayscale, given local contrast (CLAHE) and a 3px
   median before it is sent. The stored file is never changed; PDFs, WebP, large photos and
   anything sharp can't decode go as they came.

   Chosen from the real model on the lightly blurred photo (18 reads each, 2026-10-01):

   | Before sending | Correct | Not found | Wrong |
   |---|---|---|---|
   | Nothing | 0 | 1 | 2 of 3 |
   | Enlarge only | 5 | 9 | 4 of 18 |
   | **Enlarge, CLAHE, median** | **10** | 5 | **3 of 18** |
   | Enlarge, CLAHE (no median) | 3 | 1 | 1 of 5 |
   | Sharpening | declined all; changed the date's digits on the clear photo | | |

   Medium blur and low resolution were declined by every version, with nothing made up.
   **A lightly blurred photo is still wrong about 1 read in 6** (204.73 or 210.73 for 204.75),
   so the person checking the suggestion stays the safeguard.

---

## 3. Passing criteria

1. The reader tests pin the 2000 cap and `detail: "high"` on photos, for both readers.
2. `prepare-photo.test.ts`: a small JPEG or PNG is enlarged to 2000px and gray; a photo at the
   limit, a PDF, a WebP and undecodable bytes go as they came; a sideways phone photo is turned
   upright, not stretched. One test per reader fails if the reader stops calling it.
3. The real-model runs above: no cut-off reads, no made-up amounts on the low-resolution photo,
   numeric dates read month/day/year.

Not covered: a second read to catch the light-blur cents and made-up vendors (would double the
cost per receipt; declined 2026-10-01).
