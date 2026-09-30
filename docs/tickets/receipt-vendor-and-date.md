# Show the vendor and date from a receipt on Add Expense

**Priority:** _(set in Notion)_

---

## Background

On the Plus plan, when a receipt is uploaded on Add Expense, the app already reads its Subtotal, Tax, Fees and Total paid. It shows them in a box with **Use these amounts**. This only happens when "Read amounts from uploaded documents" is on in Settings.

Everything else about the expense is still typed by hand. Misty asked for help with one mistake in particular: an expense entered under one vendor while the receipt attached to it comes from another. The simplest way to prevent that is to show the person what the receipt says while they are entering the expense.

## Goal

When a receipt is uploaded on Add Expense, the app also reads **who was paid** and **the date on the receipt**. It shows both, each with an **Add** button. One click puts the value into the form. Nothing is filled in without a click, and nothing new is saved.

Example: Misty adds an expense and uploads a receipt printed "THE HOME DEPOT #2718 ... 09/12/2026 ... TOTAL $84.17". Above the amounts box she sees:

> Vendor on this receipt: **Home Depot** [Add]
> Date on this receipt: **9/12/2026** [Add]

She presses **Add** next to the vendor. Name becomes "Home Depot". Home Depot is already in her vendor library, so the line item, description and payment source fill in, as they do today when she types a remembered name. She presses **Add** next to the date, then **Use these amounts**. The expense is ready to save.

---

## 1. What is read

Vendor and date come from the same read that already gets the amounts. There is still one read per file, as today.

- **Vendor:** the business or person paid, written the way a person would write it. For example "Home Depot", not "THE HOME DEPOT #2718", and "Amazon", not "AMAZON.COM SERVICES LLC".
- **Date:** the date of the purchase or of the invoice, never a due date.
- If the receipt doesn't show one of them, leave it out. Nothing is guessed.
- A date later than today is left out.
- If a receipt's amounts can't be read but its vendor can, the vendor is still shown.
- Only **receipts** (the "Receipt / justification" field) are read for vendor and date. Proofs of payment keep reading amounts only, because bank lines like "POS DEBIT WAL-MART #2345" are too messy to be useful.

## 2. The vendor and date box (Add Expense)

A small box in the same Plus style as the amounts box, placed just **above** it. It has up to two rows:

- "Vendor on this receipt: Home Depot", with an **Add** button
- "Date on this receipt: 9/12/2026", with an **Add** button

The date is shown the way the rest of the app shows dates: 9/12/2026.

Rules:

- It appears once every receipt has finished reading.
- A row disappears once the field already holds that value. For example, Name is already "home depot" (capitals and spaces don't matter), or Date is already 9/12/2026.
- **Several receipts:** the vendor row shows only if they all name the same vendor, and the date row only if they all show the same date. Otherwise that row is not shown.
- "No receipt available" ticked: no box.
- ~~Pressing **Use these amounts** hides the amounts box, as today.~~ **Amended 2026-09-29 (usability #58):** the amounts box now stays open after Use and shows "✓ Amounts used"; only Dismiss hides it (PHASE-10). Neither hides this box.
- On a locked month, the Add buttons are disabled like the rest of the form.

## 3. What Add does

**Add next to the vendor** fills **Name**.

- If the vendor matches one in the vendor library (Settings, Vendor Library), use the **library's spelling**. Name prints on the cover sheet, so it should read the same every month. Examples:
  - Receipt "The Home Depot" with library "Home Depot" gives Name "Home Depot".
  - Receipt "Lowe's" with library "Lowes" gives "Lowes".
- Matching ignores capitals, punctuation, a leading "The", store numbers, and endings like Inc, LLC or .com. Nothing looser: "Amazon Web Services" does not match "Amazon", because it would pull in Amazon's line item.
- If two library entries could match, don't guess: use the receipt's spelling.
- After that, vendor memory fills the line item, description and payment source, **only where they are empty**. This is the same as typing a remembered name today.
- It **never** fills the remembered amounts. The amounts come from the receipt, through **Use these amounts**. So pressing Use these amounts afterwards must not ask "Replace the amounts you typed?".
- If something was already typed in Name, Add replaces it, since it's a deliberate click.

**Add next to the date** fills **Date** only. The Month stays as it is: the reporting month and the receipt date are separate on purpose.

## 4. Edit expense

Today, on Edit, nothing is read until **Read amounts from documents** is pressed.

Change: when a **new** receipt or proof is picked on Edit, reading starts on its own. It reads the files already attached too, exactly as if the button had been pressed. If only the new file were read, **Use these amounts** would replace the amounts with just the new file's share and lose the rest.

- Opening the Edit page still reads nothing.
- The vendor and date box shows on Edit too, with the same rules.
- The note under the upload fields on Edit becomes: "AI reads the amounts when you add a file, or when you press Read amounts from documents."

## 5. Screens that must stay exactly as they are

- **Add from invoice:** the invoice screen and its expense cards.
- **Editing a draft** (Waiting for review): no box, and no reading on its own. The note keeps today's text: "AI reads the amounts when you press Read amounts from documents."
- **Monthly summary.**
- Organizations without Plus, or with the switch off: nothing is read and nothing is shown.

## 6. Wording elsewhere

- **Settings, help text under the switch:** "Receipts and proofs of payment are sent to OpenAI to suggest amounts, and a receipt's vendor and date. OpenAI doesn't use them for training. Nothing is saved until you confirm."
- The switch label stays "Read amounts from uploaded documents".
- **Add Expense tour, receipt step (Plus):** "Add the receipt, invoice or timesheet. With Plus, AI reads its amounts, vendor and date and shows them for you to add. Nothing is filled in until you choose to use it. If there isn't a receipt, check No receipt available and give a reason. The reason prints on the cover sheet."
- **Settings tour, switch step:** "Included with Plus. When it's on, AI reads the receipts and proofs of payment added to an expense and suggests the amounts, and a receipt's vendor and date. Nothing is filled in until someone chooses to use them. Only an admin can change this."

No long dashes in any of the app's wording.

---

## Not part of this ticket

- Flagging saved expenses whose receipt doesn't match, or an "It's correct" button
- Suggesting a line item or description from the receipt
- Reading the vendor or date from proofs of payment
- Reading receipts on expenses that already exist
- Renaming the Settings switch

## Done when

- **The Home Depot example works.** Receipt "THE HOME DEPOT #2718", dated 09/12/2026, with "Home Depot" in the vendor library:
  - Both rows show.
  - Add fills Name, and then the line item, description and payment source.
  - The amounts stay empty.
  - Use these amounts then fills them with no "Replace" question.
- **Date Add** changes Date and leaves Month alone.
- **Reverse order:** using the amounts first, then adding the vendor, leaves the amounts unchanged.
- **Unknown vendor:** a vendor not in the library fills Name as read, and nothing else changes.
- **Several receipts:** two receipts from different vendors show no vendor row. The same vendor on two different days shows the vendor row only.
- **Other documents:**
  - A proof of payment on its own shows no box.
  - A receipt dated in the future shows no date row.
  - A receipt whose amounts can't be read still offers its vendor.
- **Photos:** phone photos and iPhone (HEIC) photos of receipts work like PDFs.
- **Saving during a read:** saving while a receipt is still being read works normally.
- **Edit:**
  - Opening the page reads nothing.
  - Adding a receipt reads it and the attached ones, and the amounts cover all of them.
- **Unchanged screens:** Add from invoice, draft editing, the switch off and a non-Plus organization all behave exactly as before.
- **Cost:** still one AI read per file, as today, in the same usage log.
- **Phone width:** long vendor names wrap, and Add stays easy to press.
- **Real receipts:** tested with about 10 real-looking receipts (store, online order, restaurant, invoice, timesheet). What was read for each is written down in the PR.
- **Docs:** the docs describe the new behaviour.

## Open questions

1. **Date format in the box.** Suggestion: 9/12/2026, the same as everywhere else in the app.
2. **Switch name.** It now covers the vendor and date too. Suggestion: keep "Read amounts from uploaded documents" for now and rename it later if people are confused.
