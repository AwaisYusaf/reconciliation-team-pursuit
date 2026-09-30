# Phase 19: The vendor and date from a receipt, offered on Add Expense

**Status (2026-09-29): built, reviewed and browser-tested with the real model (branch `feat/receipt-vendor-date`).** Ticket:
`docs/tickets/receipt-vendor-and-date.md`. Decision D-133. No migration, no new environment
variable. It uses the same Plus plan gate, Settings switch and OpenAI model as Phase 10.

---

## 1. What this is

Misty asked for a check that the uploaded documentation matches the expense. If the expense is
entered as one vendor or category and the receipt appears to be from another, the discrepancy
would be flagged for review, warning only, and the person either corrects the documentation or
confirms it is accurate.

Awais narrowed it on 2026-09-29: **no comparison and no saved flag.** Mistakes are prevented at
entry instead. Phase 10 already reads a receipt's Subtotal, Tax, Fees and Total when it is
picked on Add Expense. The same read now also returns **who was paid** and **the date on the
receipt**. Each is shown with an **Add** button above the amounts box. Nothing fills without a
click, and nothing new is stored.

What Misty is told: the app shows the vendor, date and amounts it reads from each receipt while
the expense is entered, with an Add button for each. It does not flag saved expenses, so the
"confirm it is accurate" part of her request is not built.

---

## 2. Decisions (Awais, 2026-09-29)

| # | Decision | Why |
|---|---|---|
| Q1 | Suggestions only. Nothing is compared, flagged or stored: no Expenses-list pill, no "It's correct", no migration | Awais: "Skip vendor name comparison. It should show a suggestion". Names mix vendors, labels ("Payroll - Pay Period 1", "Reimbursed Purchases") and people, so any comparison raises false alarms |
| Q2 | Amounts are not compared either. They stay exactly as Phase 10 shows them, with Use these amounts | Awais: "we'll show them the extracted amounts and allow them to click, add" |
| Q3 | Vendor Add fills **Name**, using the vendor library's spelling when the read vendor matches a remembered vendor | Name prints on the cover sheet (R6.2), so it should read the same every month, and the match lets vendor memory fill the rest |
| Q4 | A name added from a receipt fills line item, description and payment source from memory, blanks only, and **never** the remembered amounts | The amounts come from the receipt. Remembered ones would get ahead of them and make Use these amounts ask "Replace the amounts you typed?" about figures nobody typed |
| Q5 | Date Add fills **Date**, never the reporting Month | R2.2: date and month are independent |
| Q6 | Receipts only. Proofs of payment stay amounts-only | Bank lines ("POS DEBIT WAL-MART #2345") are too messy to name a vendor |
| Q7 | Same gate as Phase 10: Plus plan, the Settings switch, the OpenAI env. The same one read per file and the same `amount_read` usage row | No second call, no new enum value, no new switch |
| Q8 | On Edit, picking a new receipt or proof starts reading on its own, and reads the attached files too, as if Read amounts from documents had been pressed. Opening the page reads nothing | Recurring expenses only get receipts on Edit. Reading only the new file would make Use these amounts replace the total with that file's share |
| Q9 | Add from invoice (its cards) and draft editing are unchanged: no box, and no reading on its own on drafts | Awais: the invoice import is a separate one-go flow. Draft files live in their own table, which the read route doesn't look in (a separate task) |
| Q10 | Saving during a read saves normally | Phase 10's rule: saving always works |
| P1 | Several receipts: a vendor is offered only if they all name the same vendor, a date only if they all show the same date | Offering one of several would be a guess |
| P2 | A row hides once the field already holds that value (Name compared ignoring capitals and spaces) | No dismiss state to keep, and no button that would do nothing |
| P3 | A date after today (America/Detroit) is dropped, and so is any date that is not a real calendar date | A future purchase date is a misread. Same strict calendar check as the invoice reader, now shared in `src/domain/dates.ts` |
| P4 | Output cap raised from 400 to 600 tokens | Local reads already reached 267 of 400 with five fields. A reply cut short fails the whole read, amounts included |

---

## 3. Passing criteria

1. Add Expense, a receipt printed "THE HOME DEPOT #2718", 09/12/2026, with "Home Depot" in the vendor library: "Vendor on this receipt: Home Depot" and "Date on this receipt: 9/12/2026" show above the amounts box, which is unchanged.
2. Vendor Add fills Name "Home Depot", then line item, description and payment source (blanks only); the amounts stay empty; Use these amounts then fills them with no Replace question.
3. Date Add changes Date and not Month. Using the amounts first and then adding the vendor leaves the amounts unchanged.
4. An unknown vendor fills Name as read and nothing else.
5. Two receipts from different vendors: no vendor row. Same vendor, different dates: the vendor row only. A proof on its own: no box. A future date: no date row. Amounts that can't be read ("12,50"): the vendor is still offered.
6. Phone photos and HEIC photos behave like PDFs.
7. Saving while a receipt is being read saves normally.
8. Edit: opening reads nothing; adding a receipt reads it and the attached ones, and the amounts cover all of them.
9. Add from invoice, draft editing, the switch off and a base-plan organization are unchanged.
10. One `ai_usage_events` row per file (`amount_read`), as before.
11. At 375 px, long vendor names wrap and Add stays reachable.
12. Every new guard has a test that fails when the guard is removed.

---

## 4. Changes

| Where | What |
|---|---|
| `src/services/openai/read-amounts.ts` | A receipt's request uses `RECEIPT_SCHEMA` (the Phase 10 schema plus `vendor` and `date`, both required, string or null) and asks for them in the prompt; a proof's schema and prompt are unchanged (only the output cap is shared). The parser reads them before the `found` check, receipts only, so they ride on "none" as well as "found"; a failed read carries nothing. Vendor: spaces collapsed, null when empty, over 120 characters or letterless. Date: `isoDateFromPrinted`, null when not a real date or after today. A bad field never costs the other or the amounts. Output cap 400 to 600 |
| `src/domain/dates.ts` | `isoDateFromPrinted`, moved from `read-invoice.ts` (which imports `read-amounts.ts`, so exporting it there would have made a cycle). The invoice's date behaviour is unchanged |
| `src/domain/vendor-match.ts` (new) | `vendorKey`, `matchLibraryVendor`, `sameName` |
| `app/api/files/read-amounts/route.ts` | After the usage row, a receipt's vendor is matched against the session organization's own `vendor_defaults` and returned in the library's spelling; `vendor` and `date` are added to the response only when read, so a response with neither is Phase 10's exactly. A failed library lookup keeps the vendor as read |
| `src/domain/amount-suggestion.ts` | `ReceiptDetails` on `FileReadResult`; `aggregateReceiptDetails` (receipts only, waits for every receipt, a vendor only when all agree by `vendorKey`, a date only when all agree); `readingFor` (when the form reads, and whether it offers the box) |
| `src/modules/expenses/use-amount-reads.ts` | Carries `vendor` and `date` into the cached result, on "none" too |
| `src/modules/expenses/amount-suggestion-panel.tsx` | `ReceiptDetailsSuggestion`: Plus frame, `aria-live`, one row each with an Add button whose accessible name says what it does ("Add Home Depot as the name") |
| `src/modules/expenses/expense-form.tsx` | `readingFor` replaces the inline rule; the box above the amounts panel on Add and Edit only; the Add handlers; a `nameFromReceipt` ref that the vendor lookup reads once to fill memory without amounts and without dropping the suggestions list open; the upload note for Add, Edit and draft; the changed field briefly highlighted |
| `src/modules/expenses/vendor-fill.ts` | `fillFromTypedName(..., { amounts: false })` |
| `src/domain/strings.ts` | The box's labels and Add names; `aiUploadNoteEdit` rewritten and `aiUploadNoteDraft` added; the Settings help text and the two tour steps mention the vendor and date |

**Departures from the plan, found while building:**

- **No prefix matching.** The plan allowed a library name that starts the receipt's vendor to
  match. That would turn "Amazon Web Services" into "Amazon" and pull in Amazon's line item, so
  matching is exact after normalising. The ticket's "Lowe's Home Centers" example became
  "Lowe's".
- **The autofill highlight never showed.** Every control carries `bg-surface`, `cn` joins classes
  without merging, and `bg-surface` wins on stylesheet order, so a plain `bg-autofill` does
  nothing. The new Name and Date highlight uses `bg-autofill!`. Vendor memory's existing highlight
  on Description and Line item is left as it was (invisible): making it show also showed it
  firing when nothing was filled, which is a separate fix (TASKS R17).
- **Phone layout.** At 375 px the box's Plus badge took a column of its own and a long vendor name
  wrapped to six lines. The badge is hidden below `sm` (the amounts panel just below carries
  one), and each row's text keeps a minimum width so Add wraps under it on a very narrow row.

---

## 5. Results

**Review (a read-only agent over the diff, 2026-09-29).** No blocking defects. Fixed:

- A trailing number of any length was dropped from a name, so "Motel 6" matched "Motel" and
  "Payroll Pay Period 3" matched "Payroll - Pay Period 1". Now only three digits or more.
- A name in another alphabet reduced to nothing, so two different ones "agreed". Now any
  script's letters are kept.
- Add removed its own row, so focus fell to the page, and a double-click also added the row that
  moved up under the pointer. Now a second Add within half a second is ignored, and focus moves
  to the Add that is left, or to the filled field (scrolled to only when Add was pressed from the
  keyboard). Both were checked in the browser: a real double-click added the vendor only, and
  Enter on the date's Add filled Date and focused it.
- The route reply's mapping in the form's hook is now a pure, tested function (`readResultFrom`).
- A proof's request shares the raised output cap, which two comments had called unchanged.

Left as is: an invoice card's added receipt now also asks the model for a vendor and date that
the card never shows (a few output tokens). The `nameFromReceipt` wiring in the form has no unit
test (the repo has no component tests); the browser pass covers it.

**Tests.** The full suite passes (216 files, 2,892 tests, before the review fixes), plus typecheck
and lint. Every new guard was broken on purpose and a test failed each time:

- **Reader:**
  - `date` dropped from `required`
  - the receipt schema sent for proofs
  - the receipt-only check removed (a proof's "none" path then carried a vendor; that test was
    added after the first mutation survived)
  - details dropped from "none" or from `found: false`
  - the future-date check removed, or `<=` turned into `<`
  - the length, letter and type guards removed
- **Matcher:**
  - "the", endings or store numbers kept
  - ties guessed
  - prefix matching
- **Route:**
  - the raw vendor returned
  - the `org_id` filter dropped
  - details dropped on "none"
  - a `vendor` key always sent
- **Domain:**
  - no wait for pending reads
  - proofs used
  - no agreement check
  - "No receipt" ignored
  - drafts auto-reading
  - Edit never auto-reading
  - the box offered on a card or a draft
- **Vendor memory:** the `amounts` option ignored.

**Real model** (`gpt-5.6-luna`, synthetic receipts, 2026-09-29):

| Document | Vendor read | Library match | Date | Amounts | Output tokens |
|---|---|---|---|---|---|
| "THE HOME DEPOT #2718", 09/12/2026, PDF | Home Depot | Home Depot | 2026-09-12 | $80.00 + $4.17 | 55 |
| Home Depot, 09/13/2026, PDF | Home Depot | Home Depot | 2026-09-13 | $15.00 + $0.90 | 55 |
| "LOWE'S HOME CENTERS, LLC", PDF | Lowe's | none in Mantaq | 2026-09-12 | $45.00 | 95 |
| Cafe Luna, phone-style JPEG | Cafe Luna | none | 2026-09-20 | $23.50 | 145 |
| "STAPLES INC. #0412", dated 12/15/2026 | Staples | none | dropped (future) | $30.00 + $1.80 | 89 |
| "CAFE EUROPA", "12,50" | Cafe Europa | none | 2026-09-10 | $12.50 (the model wrote "12.50" itself) | 100 |
| Long three-line co-op name, JPEG | Northwest Detroit Community Hardware and Building Supply Cooperative Association | none | 2026-09-18 | $64.00 | not recorded |
| Timesheet (Emerald Sims) | none (the model returned null: a timesheet shows no payment) | none | none | none found | 68 |
| Bank line proof | not asked | n/a | n/a | $84.17 | 83 |

The highest output was 145 tokens, well under the new cap. A "12,50" reply could not be
produced with this model; the refused-amount path is covered by unit tests.

**Browser** (the Mantaq organization on Plus, local, with a test "Home Depot" vendor carrying
remembered $50.00 + $3.00):

- **Add:**
  - The Home Depot receipt shows both rows above the unchanged amounts panel.
  - Vendor Add fills Name "Home Depot", then the line item, payment source and description, and
    leaves the amounts empty. Use these amounts then fills $80.00, $4.17 and $0.00 with no
    Replace question.
  - Date Add sets 9/12/2026 and leaves Month on November 2026.
  - Adding the vendor after using the amounts leaves the amounts alone.
  - Typing a remembered name still fills its amounts, as before.
- **Several receipts and other documents:**
  - An unknown vendor (Cafe Luna, from a photo) fills Name only, and no suggestions list opens.
  - Home Depot plus Lowe's shows the date row only; Home Depot on two days shows the vendor row
    only.
  - A proof alone shows no box.
  - The future-dated receipt offers its vendor and no date.
- **Saving:** saving while a receipt is still reading saves normally, and the server still logs
  that read.
- **Edit:**
  - Opening reads nothing.
  - Adding a receipt made two reads (the new file, and the attached one by `documentId`), and the
    panel totalled both ($100.07). The box stayed hidden because Name already matched and the
    dates differed.
  - With two receipts dated 9/12, it offered the date.
- **Unchanged screens:**
  - An invoice card's added receipt reads amounts as before and shows no box.
  - Fixed after the 2026-09-30 browser test: on Edit of an expense approved from an invoice,
    adding a proof read the whole invoice (its receipt), offered the invoice's vendor as the
    charge's name and the bill's $800.30 as its amounts. The imported invoice (`fromInvoice`,
    same object as an `expense_imports` row of the org) is now left out of every read.
  - Draft edit reads nothing on opening or when a file is added. Its button reads amounts only
    and shows no box.
  - The draft's own file came back 404, "No amount found": the existing bug recorded as TASKS R16,
    which is why drafts stay off automatic reading.
- **Phone:** at 375 px there is no sideways scroll, and both Add buttons are visible and
  clickable (47 px tall).
- **Not checked in the browser:** the Settings switch off and a base-plan organization (the gate
  is unchanged, and `readingFor({ allowed: false })` and the route's access tests cover them),
  HEIC photos (they become JPEGs in the browser before reading, as in Phase 10), and replaying the
  tours (their new text was confirmed in the rendered page data).
- **Two transient failures:** two reads that overlapped a Save failed with no tokens (a network or
  OpenAI error; the dev log recorded only `amount read failed {}`, because an object argument is
  lost in the log file). Both scenarios, repeated, then succeeded. They are recorded here in
  case it recurs.

---

## 6. Not in this phase

- Comparing or flagging mismatches, a saved flag, an Expenses-list pill, "It's correct"
- Suggesting a line item or description from the receipt
- Reading the vendor or date from proofs of payment
- Reading receipts on expenses that already exist
- Renaming the Settings switch
- Draft edit's Read amounts from documents looking in the wrong table for draft files (a separate task)
