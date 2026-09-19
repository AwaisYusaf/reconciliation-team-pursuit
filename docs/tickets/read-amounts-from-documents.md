# Read amounts from uploaded receipts

**Priority:** _(set in Notion)_

---

## Background

When Misty adds an expense, she uploads the receipt and the proof of payment, then types the Subtotal, Tax and Fees from those same documents. Typing numbers already in front of the app is slow, and it's easy to mistype. A wrong amount ends up on the cover sheet the City reads.

Today the app doesn't read uploaded documents at all.

## Goal

When a receipt or proof of payment is uploaded, the app reads it and suggests the **Subtotal, Tax, Fees and Total paid**.

- If there are several receipts, their amounts are added together.
- The user always reviews the suggestion and chooses to use it. Nothing is filled in or saved without a person confirming.
- If a document can't be read (handwritten, blurry, unusual layout), the app says so and the user types the amounts as today.

---

## 1. What gets read and how it adds up

Only **Receipt / justification** and **Proof of payment** files are read. **Supporting documents** are never read.

A receipt and its proof of payment usually show the same payment, so they aren't added together:

- **Receipts are added up.** For example, two Staples invoices of $120.00 and $45.00 give a total paid of $165.00.
- **Proofs of payment are a check.** If the proofs add up to something different, show a warning: "Receipts add up to $165.00 but proofs of payment show $170.00. Check the amounts before saving."
- **No receipt:** if "No receipt available" is ticked, or only proofs are uploaded, the proofs are added up instead. This covers salaries and ATM withdrawals, for example.
- **Nothing to read:** a document with no amount (such as a timesheet), or with many unrelated amounts (such as a full bank statement), is skipped. It shows as "No amount found".
- **Total paid doesn't add up:** if a receipt's total doesn't match its subtotal + tax + fees, show the figures as read and add: "The amounts on this receipt don't add up. Please check them."

All amounts are US dollars.

---

## 2. Add Expense: reading when files are chosen

As soon as a receipt or proof of payment is chosen, the app starts reading it. The user can keep filling in the rest of the form while it reads.

A panel appears next to the amount fields (Subtotal / Tax / Fees). It has three states.

**While reading:** "Reading 2 documents…"

**Done:**

> **Amounts found in your documents**
> Subtotal $150.00 · Tax $9.00 · Fees $6.00 · **Total paid $165.00**
>
> - Staples invoice 0412.pdf: Subtotal $110.00 · Tax $6.60 · Fees $3.40 · Total $120.00
> - Staples invoice 0418.jpg: Subtotal $40.00 · Tax $2.40 · Fees $2.60 · Total $45.00
> - Bank transaction.png (proof of payment): $165.00 ✓ matches
>
> [**Use these amounts**]  [Dismiss]

**Couldn't read anything:** "We couldn't read amounts from these documents. Please enter them yourself."

**Rules:**

- **Nothing is filled in until the user presses "Use these amounts".** That button puts the figures into Subtotal, Tax and Fees, and they can still be changed before saving.
- **Typed amounts aren't replaced silently.** If the user already typed amounts, "Use these amounts" replaces them only after a confirm: "Replace the amounts you typed?"
- **Files change, the suggestion updates.** If a file is added or removed after the panel appears, the panel reads again and shows the new totals.
- **Reading never blocks saving.** If it fails, is slow, or the service is down, the user can type the amounts and save as today.
- **Only amounts are read.** The panel never touches Name, Description, Date or any other field.
- **The reimbursable amount follows the funding source's rules.** Once the amounts are in, "Reimbursable amount" and the cover sheet's tax/fee note work exactly as they do today.

---

## 3. Edit expense: reading on request

On an existing expense, nothing is read automatically, so old expenses never change by surprise.

- Near the amount fields, add a button: **Read amounts from documents**.
- It reads the receipts and proofs attached to the expense, plus any files just added, and shows the same panel as on Add Expense.
- The button is hidden when the expense has no receipts or proofs attached.
- The button is hidden when the month is locked.

---

## 4. Settings switch

Under **Settings → Organization**, add a switch:

- **Label:** "Read amounts from uploaded documents"
- **Help text:** "Receipts and proofs of payment are sent to OpenAI to suggest amounts. OpenAI doesn't use them for training. Nothing is saved until you confirm."
- **On by default** for every organization, including Team Pursuit.
- Only admins can change it.

When it's off, no document is sent for reading, the panel and the Edit button don't appear, and the form works exactly as it does today.

**Later this will be limited to the "Reconciliation + AI" plan.** Put the "is this organization allowed to use it?" check in one place, so adding "and is on the right plan" later is a small change. Plans come from the Admin dashboard ticket. Until then, only the Settings switch decides.

---

## 5. Reading service (OpenAI)

- **Model:** OpenAI **gpt-5.6-luna**. It's OpenAI's low-cost model for high-volume work, reads images and PDFs, and costs about a tenth of a cent per receipt.
- **The model name is a server setting, not written into the code.** If testing shows too many misreads, Awais can switch to a stronger model (for example gpt-5.4-mini) without a new release.
- **The OpenAI key is a server setting.** Awais adds it on the server. Without a key, the feature stays hidden, as if the Settings switch were off.
- **Files and answers aren't stored at OpenAI.** Ask OpenAI not to store the request. OpenAI doesn't train on API data by default. It may still hold requests for up to 30 days for abuse checks, unless OpenAI approves us for Zero Data Retention; Awais decides whether to apply.
- **Always the same four fields.** Ask for Subtotal, Tax, Fees and Total paid in a fixed format, plus "no amount found" when the document has none. Never accept free text.
- **Files are sent as they'll be stored.** HEIC photos are converted to JPEG before sending, the same as on upload.
- **Each read is logged**: organization, number of files, success or failure, and cost. This lets us see usage per organization later, when the feature moves to a paid plan.

---

## 6. Tour text

The Add Expense tour's amounts step says: "Enter the amounts from the receipt. If there's tax or fees, you'll be asked whether the funder pays for them."

Change it to: "Enter the amounts from the receipt, or upload the receipt below and use the amounts we find. If there's tax or fees, you'll be asked whether the funder pays for them."

When the Settings switch is off, keep the old text.

---

## Not part of this ticket

- Reading the vendor name, date, description or line item
- Reading supporting documents or month documents (such as bank statements)
- Recurring one-click add, since it has no uploads
- Limiting the feature to a plan (it's switched on per organization for now)
- Going back and reading receipts on expenses that already exist
- Currencies other than US dollars

---

## Done when

- **Add Expense:** choosing a clear receipt shows the panel with Subtotal, Tax, Fees and Total paid. "Use these amounts" fills the fields.
- **Several receipts:** their amounts are added together, and each file's figures are listed.
- **Proof checks:** a proof that matches shows "matches". A proof that differs shows the warning.
- **Proofs only:** an expense with only proofs, or "No receipt available", adds up the proofs.
- **Nothing to read:** a timesheet or unreadable photo shows "No amount found" and doesn't break the rest.
- **Nothing without confirmation:** no amount is filled in or saved until "Use these amounts" is pressed, and typed amounts are only replaced after the confirm.
- **Saving always works:** the form still saves normally if reading fails or is slow.
- **Edit:** "Read amounts from documents" works on existing expenses and is hidden on locked months.
- **Settings switch:** turning it off stops all reading and hides the panel and button. Managers can't change it.
- **Numbers still agree:** reimbursable amount, cover sheet note and totals are the same as if the amounts were typed by hand.
- **Real-receipt test:** tried on at least 10 real-style receipts (clear PDF, phone photo, HEIC, multi-page PDF, handwritten) with gpt-5.6-luna. The PR lists each result and the average cost per receipt.
- **No key, no feature:** with no OpenAI key on the server, the feature stays hidden and the form works as today.
- **Tour and screens:** the tour text is updated, and screens look right on phone, tablet and desktop.

## Open questions

1. **Long PDFs.** Should a 20-page PDF be read in full? The suggestion is to read only the first 5 pages, to keep cost and wait time down, and say so in the panel.
2. **Tips and discounts.** Where does a restaurant tip go? The suggestion is Fees, so the funding source's fee rule decides whether it's reimbursed. A discount reduces the Subtotal.
