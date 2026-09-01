# Phase 3 — client-reported fixes

Three items from Misty after testing. Independent of each other, so they run in any order; taken
in the order below because T2 is the only one a funder can see.

**How each one runs.** One at a time, through five gates: plan → review the plan against the edge
cases here → implement → review the implementation adversarially → test in the browser → commit.

Two things learned in Phase 2 and applied from the start here:

- **Audit before declaring done, not after.** Every defect that survived Phase 2 was two code paths
  that had to agree where only one was updated. The tests passed through all of them.
- **Render or click anything called verified.** The last three Phase 2 defects surfaced only when a
  document was actually opened rather than reasoned about.

**Status:** T1, T2 done. T3 not started. `Last reviewed: 2026-09-01.`

---

# T1 · Money fields accept letters — done

> We can add alphabets in subtotal, tax & fee. Limit it to numbers only.

### What exists today

`MoneyInput` ([field.tsx](../src/components/ui/field.tsx)) renders a plain `<input>` with
`inputMode="decimal"` and no other constraint. `inputMode` is a **keyboard hint on touch devices
only** — it does nothing on a desktop keyboard, so "abc" types straight in.

The server is not fooled: `parseMoneyToCents` returns `null` for anything unparseable and
`parseMoneyToCentsOrZero` turns that into 0 (R1.1). So today, typing `12abc` in Subtotal saves a
**$0.00 expense** without complaint — the figure is silently wrong rather than rejected.

### Phases

- **T1.1** — Constrain `MoneyInput` so non-numeric characters cannot be entered at all.
- **T1.2** — Keep every shape the parser already accepts: `1,234.56`, `$1,234.56`, a leading `-`
  for refunds (R1.4), and `(145.00)` accounting negatives. Rejecting those would break real entry.
- **T1.3** — Check every caller: the expense form's three fields, the recurring template's tax and
  fees, and the line-item and contract-settings money fields.

### Passing criteria

- [x] Letters cannot be typed into any money field.
- [x] A refund still accepts `-145.00`, and `1,234.56` / `$1,234.56` / `(145.00)` still parse.
- [x] Paste is constrained too, not just keystrokes.
- [x] A partially-typed value (`12.`, `-`, `.5`) is not destroyed mid-entry.
- [x] The server-side parse remains the authority — the input is a convenience, never the guard.

### What was found in testing

The caret behaviour could not be checked through the test harness: its `Left` key does not move
the caret, so `1234` + Left + Left + `9` produced `12349` **with no letters involved at all**. That
looked like a caret bug in the fix and was not one — the control test isolated it to the harness.
Verified instead by driving the field through the exact path a real keystroke takes (browser
mutates the value, fires `input`) with only the caret scripted:

| Action on `1234`, caret at 2 | Result | Caret |
|---|---|---|
| type `a` | `1234` — rejected | stays at 2 |
| type `9` | `12934` | 3 |
| type `-` at the front | `-1234` | 1 |
| paste `abc` | `1234` — rejected | stays at 2 |

### Edge cases that must not be missed

- **Blocking keystrokes breaks paste, autofill and mobile dictation** if done with `onKeyDown`.
  Filtering the *value* on change is the only approach that covers all input methods.
- A user mid-type has `12.` or `-` in the field, neither of which is a valid number. Rejecting
  those makes the field impossible to type in.
- The caret jumps to the end if the value is rewritten naively while editing mid-string.
- `parseMoneyToCentsOrZero` turning garbage into `0.00` is the reason this is a *money* bug and
  not a cosmetic one — worth keeping in mind when deciding how loud the rejection should be.

---

# T2 · Cover-letter total wraps — done

> Fix number formatting on the yellow-highlighted total; last digit and cents are wrapping to the
> line below. Apply to all cover letters.

### What exists today

The total row's Amount cell is shaded yellow and bold
([cover-sheet-docx.ts:140](../src/generation/cover-sheet-docx.ts)). The Amount column is **15% of a
6.5" text width = 0.975"**, less 0.11" of cell margins ≈ **0.86" of usable width**. At 10 pt bold,
a figure like `$1,234,567.89` exceeds that and wraps; the total is bold, so it is the widest text
in the narrowest column and the first to break.

**This is the only item a funder sees.** The cover sheet is the approved layout, so the fix must
not alter what was signed off beyond what is needed to stop the wrap.

### Phases

- **T2.1 — Reproduce first.** Render a cover sheet through LibreOffice at a total large enough to
  wrap, and confirm the cause is width rather than something else. No fix before the wrap is
  visible in a real PDF.
- **T2.2** — Stop the wrap. Preferred: mark the amount cells no-wrap so the column expands instead
  of breaking the number. Fallback: widen the Amount column at Role's expense.
- **T2.3** — Apply to **every** amount cell, not just the total: a long body figure wraps for the
  same reason, and the client asked for all cover letters.
- **T2.4** — Re-check `page-estimate.ts`: a taller or wider table changes the page estimate.

### Passing criteria

- [x] Reproduced in a rendered PDF before any change, and gone after.
- [x] Verified through **LibreOffice**, not only in the docx — the packet renders through it, and
      Word and LibreOffice break lines differently.
- [x] Every amount, body and total, stays on one line at seven figures.
- [x] The approved layout is otherwise untouched: same fonts, sizes, borders, shading, alignment.
- [x] The February golden reference still reconciles.
- [x] `GENERATOR_VERSION` bumped for the cover sheet **and** the packet, or cached artifacts keep
      serving the wrapped version.

### What was found in testing

**The width theory was wrong on its own, and reproducing first is what caught it.** At the old
15% nothing wrapped in our PDFs at any amount, up to −$1,234,567.89. Squeezing the column to 5%
did wrap, character by character, which proved the renderer honours the declared widths and the
harness could see the defect — so the missing piece was elsewhere.

The real cause was the table being **auto-fit**: each renderer sized the columns to its own font
metrics, so LibreOffice widened Amount to fit while Word wrapped it. The bug could not exist in
anything we generated. Measured by rendering, the wrap threshold sits just under 14% — the old
15% cleared its own worst case by one percentage point, and Aptos is wider than the Carlito this
container substitutes.

Fixed layout plus 18% clears the threshold by about a third. Rendered side by side, the approved
sheet is unchanged: same fonts, borders, shading, alignment and row heights, with Role still
wrapping at the same word.

**The render guard needed a deliberate exaggeration to be honest.** Sized to the longest real
amount it passed at the broken 15% — it could not see the client's bug, because this container
has no Aptos. The check now uses a figure one digit longer, standing in for the missing font
width; mutation-tested, it fails at 15% and passes at 18%.

### Edge cases that must not be missed

- A no-wrap cell makes the column **grow**, which can push the table past the text width and
  change the whole layout. The three widths must still sum correctly.
- The longest string is not always the total: a negative body amount (`-$1,234,567.89`, R1.4) is
  one character longer.
- The Role column holds free text and already wraps deliberately — it must keep wrapping.
- `page-estimate.ts` constants were tuned against the current table; changing row height or column
  widths drifts the packet's page estimate (R10.5).

---

# T3 · Recurring tab needs search, pagination and filtering

> Add search field, pagination & line item based filtering.

### What exists today

[`recurring/page.tsx`](<../app/(app)/recurring/page.tsx>) loads **every** recurring item with no
search, filter or limit, and the table renders all of them. The expenses list already has search,
sort and two filters ([expenses-table.tsx](<../app/(app)/expenses/expenses-table.tsx>)) — so the
patterns, and the controls' visual language, already exist and should be reused rather than
reinvented.

**Pagination exists nowhere in the app.** It is new, and it is the part most likely to interact
badly with what is already there.

### Phases

- **T3.1 — Search** over name and default description, matching how the expenses search behaves.
- **T3.2 — Filter by line item**, reusing the expenses filter's shape and wording.
- **T3.3 — Pagination**, with a page size chosen from what the client actually has rather than a
  round number picked at random.
- **T3.4** — Make the three compose: filtering then searching then paging, with the page resetting
  when the filters change.

### Passing criteria

- [ ] Search matches name and description, case-insensitively.
- [ ] The line-item filter lists only line items that exist, and matches the expenses list's wording.
- [ ] Search, filter and pagination compose without one clobbering another.
- [ ] Changing a filter resets to page 1 — otherwise a user sits on an empty page 3.
- [ ] **"Added to {Month}" state stays correct** for every row on every page: it is derived per row
      from this month's expenses, so a paged-away row must not read as not-added.
- [ ] Add and Remove still act on the right row after filtering or paging.
- [ ] A search matching nothing says so, rather than rendering an empty table.
- [ ] Controls are hidden or inert when there is nothing to search — a two-item list should not
      grow a filter bar.

### Edge cases that must not be missed

- **The added-state is the trap.** `addedState` matches an expense to a template by
  `recurringItemId` (falling back to name), computed from a query for the *whole month*. Filtering
  the template list must not narrow that lookup, or a filtered row reads as "not added" and a
  second click duplicates a salary on the claim.
- Editing a row while a filter is active: the draft form must stay open on the right item.
- Deleting the last row on the last page leaves the user on a page that no longer exists.
- The client's list is small today. Pagination that only appears above a threshold avoids adding a
  control to a screen that does not need one.

---

## Open questions

| # | Task | Question |
|---|---|---|
| Q1 | T1 | Built as a **silent** rejection — the character simply does not appear, which is what a field that can only hold a number should do. Say if you would rather it showed a message. |
| Q2 | T3 | How many recurring items does Misty expect to hold? It decides the page size, and whether pagination should appear at all below a threshold. Assuming **25 per page, shown only above 25 items** until told otherwise. |

Neither blocks starting; both are one-line constants.
