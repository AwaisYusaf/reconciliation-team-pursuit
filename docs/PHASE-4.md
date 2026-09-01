# Phase 4 — Misty's submission-blocking feedback

Two items, from a client who says she is **ready to send this month's packet to the city**. One is
already built and only needs deploying; the other is real work.

**Status:** T4 done. T5 done — item 1 was not only a width problem. `Last reviewed: 2026-09-01.`

---

## What she said, and what it means

> So, a couple things. Number one, I'm ready to send this to the city, but as you can see, the
> COVID letter, the total that's in yellow, it's not formatted right. The last digit and cents on
> all cover letters is having that number at the bottom. And then also the bank statement is
> showing at the top of the reconciliation packet, so that should not be there. The bank statement
> is the last document of this running PDF. And then I need the bank statements to be at the end
> of the packet, not at the beginning, before the first cover letter.

"COVID letter" is dictation for **cover letter**. That splits into two items.

### Item 1 — the yellow total. Already fixed. Not deployed.

This is exactly T2 of Phase 3, fixed in `0c4cfb3`: the Amount column widened to 18% and the table
made fixed-layout, because auto-fit let every renderer size the columns to its own font metrics.
**She is looking at a build that does not contain the fix.**

No new work. It needs deploying, and then her eyes on it — see the caveat in
[PHASE-3.md](PHASE-3.md#t2--cover-letter-total-wraps--done): the fix is verified in LibreOffice,
and Word is where she saw the problem.

### Item 2 — bank statements at the front. Real work.

Month documents are section 2 of the packet, so a bank statement is the first thing after the
summary and index and lands **before the first cover sheet**. She wants them at the end.

**This contradicts nothing that was approved.** The funder's packet requirement (Phase 2 F6) lists
*contents* — a cover letter per category, itemized expenses, identifiers, narratives, receipts,
proof of payment, category totals, monthly totals, remaining budget — and never mentions where
bank statements sit. The front placement traces to **D-10**, our own decision, whose stated reason
("real packet contains month-scoped docs") justified *including* month documents, not putting them
first. `packet-pdf-spec.md` records that the client approved us defining our own layout. So this
is us correcting our own choice on the say-so of the person who submits the packet.

The ground truth could not settle it independently: the approved 133-page February packet is
scanned images — 2 of 134 pages carry extractable text — so its ordering cannot be read from the
file, and rendering its pages to look is not on, because it holds real PII. Misty has been
submitting these packets by hand for years; her instruction is the authority.

**Two readings, one fix.** Either the bank statement appears only at the front and must move, or
it appears at the front *and* at the end (she also attached it to an expense) and the front copy
is the wrong one. "The bank statement is the last document of this running PDF" fits both. Moving
the month-documents section to the end satisfies either.

**One judgement call.** She says "bank statement" and never mentions the other month document
categories — timesheets, combined hours, fiduciary invoice, other. Moving only bank statements
would split one coherent section and leave timesheets sitting before the first cover letter, which
is the same complaint she just made. **Assumption: the whole month-documents section moves**, in
its existing category order. Reversing this to bank-statements-only is a small change if she wants
that instead.

---

# T4 · Move month documents to the end of the packet — done

### Passing criteria

- [x] No month document appears before the first cover sheet.
- [x] The packet ends with the month documents, in the existing category order
      (bank statement → combined hours → timesheet → fiduciary invoice → other).
- [x] Sections 1 (summary), 1b (index) and the per-line-item sections keep their order and
      contents; only the position of section 2 changes.
- [x] **The packet screen's contents listing moves with it.** R11.2 requires the listing the user
      reads and the file that is assembled to come from one implementation.
- [x] Every page still carries its footer, and receipts/supporting pages still carry the right
      expense reference (D-70) — moving a section shifts every page index after it.
- [x] A month with no expenses still builds (summary + index + month documents).
- [x] A month with no month documents still builds, with no empty trailing section.
- [x] `GENERATOR_VERSION` bumped, or cached and pinned packets keep serving the old order.
- [x] Verified by **rendering a packet and reading back the page order**, not by reasoning.

### Edge cases that must not be missed

- **The page estimate** was tuned against the current layout and is what the packet screen shows.
- **Footer ownership** is collected during assembly; a reordering that computes owners against the
  old sequence would stamp the wrong reference on receipt pages — worse than a cosmetic bug,
  because the footer is the funder-approved financial trail.
- **The expense index** is a contents page. If it cites anything positional, it goes stale.
- Documents are rasterised, so a packet is large; the check must read structure, not eyeball it.

### What was found in building it

An adversarial sweep (45 agents, every claim verified against the file) found the order was
written down in **thirteen** places, and the one that mattered was not the assembler.

**The screen was a second, unconnected copy.** `app/(app)/packet/page.tsx` hardcoded the sequence
in JSX — `index={1}`, `index={2}`, `index={3}`, then `index + 4` — under a caption promising "In
the order the funder will read them". Nothing routed it through `packet-order.ts`, despite R11.2
saying the listing and the file must come from one implementation, and despite that module's own
header claiming they did. Moving only the assembler would have left the screen telling Misty the
bank statement was item 3 while the PDF put it last — the project's signature failure mode, in the
exact place a rule already warned about it.

Both now render from `packetContents`, declared once.

**The integration test never inserted a month document.** The only end-to-end packet render built
a packet with `monthDocuments: []`, so no test could have caught a bank statement at the front —
and none did. The fixture now attaches one, and the assertion reads position from the footers: a
month document carries no expense reference (D-70) and every receipt page does, so the last
referenced page must be the one before the month documents. Mutation-tested — moving the block
back to the front fails it.

`page-estimate.ts` and the expense index were investigated and are genuinely order-independent:
the estimate is per-section page counts with no sequence, and the index cites no page numbers.
`GENERATOR_VERSION` was the quiet one — a pure reorder changes no snapshot field, so the cache key
would have been byte-identical and every existing month would have kept serving the old order.

### Still worth knowing

- `scripts/render-smoke.ts` does not cover packet order: it never calls `buildPacketPdf` (that
  needs storage) and its fixture has no month documents. The deploy gate therefore cannot catch a
  future reordering — the integration test is the guard, and it needs a database to run.

---

# T5 · The cover sheet was being set in the wrong font — done

Deploying T4 made the deploy-time render gate fail, in the container, on the check added in
Phase 3: *"the total prints on one line (D-76) — the amount column is too narrow"*. It passed on
the developer machine. **The two environments disagreed about a funder-approved document**, which
is the one thing that check exists to catch.

### What it turned out to be

`fc-match Aptos` in the container returns **DejaVu Sans**. The Dockerfile installs
`fonts-crosextra-carlito` and a comment claimed that covered Aptos; it does not. Fontconfig ships
Carlito as a metric substitute for *Calibri*, nothing in the image mentioned Aptos, and there was
no alias for it anywhere in `/etc/fonts`. Every cover sheet the container has ever rendered — the
ones inside every packet — was set in DejaVu Sans, about a quarter wider per digit than Calibri.

Measured in a faithful rebuild of the image:

| Amount column | realistic `$458,692.46` | worst real `-$1,234,567.89` | guard `-$12,345,678.90` |
|---|---|---|---|
| 15% (before D-76), DejaVu | **wrapped** | wrapped | wrapped |
| 18% (D-76), DejaVu | one line | **wrapped** | wrapped |
| 18%, Carlito (D-78) | one line | one line | one line |

The first row is the client's complaint, exactly: at the width we shipped for months, a perfectly
ordinary six-figure total broke mid-number. **D-76's explanation was wrong** — it blamed Word
rendering wider than our PDFs. The width increase was still worth having, and it is what made
realistic totals fit; but the cause was ours, in our own container, in the file the city receives.

### The fix

Alias Aptos to the Carlito already installed, and **fail the image build** if
`fc-match Aptos` does not return Carlito. The width stays at 18%, which with the correct font
clears a figure a full digit longer than any amount the column can hold.

The render gate now guards the font as well as the width: sized one digit long, it fails under
DejaVu at 18% and passes under Carlito. That is how the wrong font was caught in the first place.

`page-estimate.ts`'s constants assume roughly half the point size per character — true of Calibri,
not of DejaVu — so they had been wrong for the container's whole life and are now right.

### What is verified, and what is not

- **Verified**: the whole render smoke suite passes inside a locally built copy of the production
  image; before the alias, the same suite failed there exactly as it did on the server.
- **Not verified**: the `.docx` opened in Word with genuine Aptos. Aptos is a little wider than
  Calibri and is not installable here. The PDF that goes to the city is now measured; the Word
  view of the download still rests on Misty's eyes.
