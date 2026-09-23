Some vendors send one invoice covering many charges: twelve lines on a single bill, each of which is its own expense in the app.

Today the team adds them one at a time. Twelve times they type a name, pick a line item, type the amount, write a narrative and attach the same invoice file again. Reading amounts with AI helps with one expense at a time, because it reads one document's totals into the form that is open.

## **Goal**

Upload the invoice once. The app reads its lines and creates one expense per line, **as a draft**. Drafts wait in the Expenses list until a person checks them, fills in what is missing, and approves them. Nothing a draft holds counts anywhere until it is approved.

Example: Misty uploads the March invoice from Detroit Sound Supply, which lists twelve charges. The app creates twelve drafts, ten of them already matched to the right line item. She checks them, writes two missing narratives, and presses Approve all ready.

---

## **1. Starting from an invoice (Expenses tab)**

Next to **Add Expense**, add a button: **Add from invoice**.

It opens a screen (or dialog) with:

- **Title:** "Add expenses from an invoice"
- **Text:** "Upload one invoice that covers several charges. We read its lines and create a draft expense for each one, for you to check before approving."
- A file picker for **one PDF**, up to 25 MB and 10 pages.
- Buttons: **Read invoice** and **Cancel**.

Messages when it cannot be used:

- More than 10 pages: "That file has 34 pages. Invoices of up to 10 pages can be read. For a longer document, add the expenses by hand."
- Nothing readable: "We could not find any charges on that invoice. Please add the expenses by hand."
- More than 50 lines: read the first 50 and say "This invoice has more than 50 lines. The first 50 were read. Add the rest by hand."

While it reads, the button says "Reading the invoice…".

## **2. What the app reads from the invoice**

For the invoice as a whole: the vendor name, the invoice date, and any tax or fee charged on the whole bill.

For each line: the item name, its description, its amount, and its own tax or fee when the line shows one.

Only what is printed on the invoice is used. Nothing is guessed or worked out.

## **3. Filling in each row**

For each row the app fills in what it can, in this order:

1. **A recurring item with the same name** (ignoring capitals): use its line item, payment source, description, narrative, and its usual tax and fees when the invoice line doesn't show its own.
2. **A remembered vendor with the same name**: use its line item, payment source and description. Vendors carry no narrative.
3. **No match**: the line item and the narrative stay empty, and the payment source is the organization's usual one.

Amounts always come from the invoice when the invoice shows them, over anything remembered.

The date on every draft is the invoice date. The month is the month the team is working in, the one shown in the header.

## **4. The invoice file**

The invoice PDF becomes the **receipt** on every draft it created, so it is already attached when the team opens one. Proof of payment is still missing and the team adds it, as they do today.

If the same invoice file was already used this month, the check screen says: "This invoice was already added on 04/02/2026 by Misty. Adding it again will create these expenses a second time." The team can continue anyway.

## **5. Drafts in the Expenses list**

Drafts appear at the top of the month's Expenses list, in their own section:

> **Waiting for review (12)**
>

Each draft row shows the same columns as a normal expense, plus:

- A **Draft** mark.
- What is still needed, in plain words: "Needs a line item", "Needs a narrative". A missing proof of payment is not a blocker here, since that is already shown in the normal way.
- **Approve** (only once the row has everything it needs), **Edit**, and **Discard**.

**Edit** opens the normal expense form, so there is nothing new to learn. Saving keeps it a draft.

**Discard** removes the draft, with a toast: "Draft discarded. Undo". Discarded drafts do not go to Trash.

At the top of the section: **Approve all ready (8)**. It approves every draft that has everything it needs and leaves the rest, then says "8 expenses approved. 4 still need your attention."

## **6. What a draft does not do**

Until it is approved, a draft is not part of the month at all:

- It is not in the month total, the line item spend, or the amount left on a line item.
- It is not on the dashboard.
- It is not in the Excel summary, the packet, or the cover sheets.
- It is not used by the AI monthly summary.
- It does not hold a reference number. The number is given when it is approved, like any other new expense.
- It does not block the packet. Only approved expenses are checked for missing documents.

Approving is what makes the expense real, and from that moment it behaves exactly like an expense added by hand.

## **7. Rules**

- **Approving needs:** a name, a line item, a payment source, a date and a narrative. The receipt and proof of payment stay optional at this point, exactly as they are today.
- **Locked month:** drafts cannot be created in or approved into a locked month. The usual locked message is shown.
- **Archived funding source:** cannot be used, as with any new expense.
- **Who:** admins and managers, the same people who can add expenses.
- **Availability:** the Plus plan, with the same "Read amounts from uploaded documents" switch in Settings that receipt reading uses. When either is off, the "Add from invoice" button is not shown.
- **History:** an approved expense's history shows it was created from an invoice, and who approved it.

---

## **Not part of this ticket**

- Photos or scans of invoices. PDF only for now.
- More than one invoice at a time.
- Splitting a whole bill tax or fee across the lines.
- Making expenses added by hand go through draft review.
- Creating new line items or recurring items from an invoice.
- Reading amounts for a draft again after it is created. The existing "Read amounts from documents" button in the form still works.

## **Done when**

- **Add from invoice** sits next to Add Expense on the Expenses tab, and only for organizations allowed to use AI reading.
- Uploading a PDF invoice reads its lines and shows the check screen with one row per charge, the invoice date, and the whole bill tax or fee note where there is one.
- Unticking a row leaves it out. Create drafts makes one draft expense per ticked row.
- A row whose name matches a recurring item comes with that item's line item, payment source, description and narrative. A row matching a remembered vendor comes with its line item, payment source and description. An unmatched row has an empty line item and narrative.
- Amounts on each draft are the ones printed on the invoice line.
- The invoice is attached as the receipt on every draft it created.
- Drafts show in a "Waiting for review" section at the top of the Expenses list, marked Draft, saying what each one still needs.
- Edit opens the normal form and saving keeps the expense a draft. Discard removes it with an Undo toast.
- Approve is only available on a complete draft. Approve all ready approves the complete ones and reports how many were left.
- A draft is in no total, no dashboard figure, no Excel summary, no packet, no cover sheet, and no monthly summary, and holds no reference number. Approving puts it in all of them and gives it its number.
- Drafts cannot be created in or approved into a locked month, or on an archived funding source.
- An approved expense's history shows it came from an invoice and who approved it.
- Uploading the same invoice twice in a month warns before creating the drafts again.
- An invoice over 10 pages, with no readable charges, or with more than 50 lines gives the message above instead of failing silently.
