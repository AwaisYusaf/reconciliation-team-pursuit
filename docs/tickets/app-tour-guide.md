# Add a first-time app tour guide

**Library:** React Joyride
**Priority:** Medium

---

## Background

The app is used by non-technical programme staff. Most screens are easy to follow. A few are not, because they carry rules that only become visible when something goes wrong. Examples are a month selector that changes the whole app, an expense form whose text ends up on documents sent to the City, and a month-end screen that blocks downloads.

Today the only first-time help is a one-line welcome message on the Dashboard.

## Goal

After a new user signs up and finishes the setup steps, guide them through only the confusing parts of the app. Each tour is short, shows once, and can be skipped.

We are **not** adding a tour to every tab or every field.

---

## Where the tour guide goes

There are four short tours, one per tab. Each tour starts the first time the user opens that tab, not all at once.

### 1. Dashboard tab (4 steps)

Starts on the user's first visit to the Dashboard after setup.

1. **Month selector at the top.** "This is the month you're working in. Every tab follows it, including expenses, cover sheets and the packet."
2. **Funding source selector at the top.** Show this step only if the organisation has more than one funding source. "Each funding source has its own budget, expenses and packet. Pick one, or choose All to see them side by side."
3. **Closing Balance column in the budget table.** "This turns red when a line item has less than 10% of its budget left, or is overspent."
4. **Add Expense tab.** "Add each expense when it happens, with its receipt. Then month-end takes minutes."

### 2. Add Expense tab (6 steps)

This is the most complex screen. Show the tour only when adding a new expense, not when editing one.

1. **Name field.** "Start typing. Vendors you've used before fill in the rest of the details for you."
2. **Description / role field.** "This exact text prints on the cover sheet the City reads, so write it the way it should appear."
3. **Subtotal, Tax and Fees.** "Enter the amounts from the receipt. If there's tax or fees, you'll be asked whether the funder pays for them."
4. **Reimbursable amount box.** "This is the amount being claimed. Anything not reimbursed is noted on the cover sheet."
5. **Proof of payment upload.** "Always required. Add a bank transaction or payment screenshot. Without it, the month's packet can't be downloaded."
6. **Receipt upload and the "No receipt available" option.** "Add the receipt, invoice or timesheet. If there isn't one, tick No receipt available and give a reason. The reason prints on the cover sheet."

### 3. Recurring tab (2 steps)

1. **The "Add to month" button on an item.** If the list is empty, use the "Add recurring item" button. "Nothing is added automatically. Press Add for each bill or salary you want in this month."
2. **An item already added to the month.** "Added items still need their proof of payment. Open each one from the Expenses tab to attach it."

### 4. Month-End Packet tab (5 steps)

1. **Documentation Complete column.** "Every line item needs a Yes here before you can download."
2. **The red "cannot be downloaded yet" message.** Show this step only when that message is on screen. "These expenses are missing a document. Open expense takes you straight to the fix."
3. **Month documents section.** "Bank statements, timesheets and the fiduciary invoice go here. They're optional and never block a download."
4. **Download buttons.** "Download the packet PDF for signing and the Excel summary."
5. **Mark as submitted.** "Mark the month as submitted once it's sent. You can still correct it later."

If "All funding sources" is selected, this tab asks the user to choose one source first. Don't start the tour until a source is chosen.

---

## Tabs with no tour

These tabs are clear enough on their own:

- Sign up and the setup steps
- Expenses
- Cover Sheets
- Contract Summary
- Line Items
- Settings

---

## How it should behave

- Every user sees each tour once. This includes staff added later, not just the person who signed up.
- The user can skip a tour at any time. Skipping or finishing means it doesn't show again.
- Once a tour is done, it shouldn't reappear when the same user logs in on another device, like their phone.
- Settings has a "Show the app guide again" option that brings all the tours back.
- The tours must look right and be easy to tap on a phone.
- Keep the existing welcome message on the Dashboard.

## Done when

- A new user who signs up sees the Dashboard tour right after setup.
- The Add Expense, Recurring and Month-End Packet tours each start on the first visit to that tab.
- Skipped or finished tours don't come back, including on another device.
- "Show the app guide again" in Settings replays all tours.
- Steps that only apply sometimes, like the funding source step or the "cannot be downloaded" step, appear only when relevant.
- Every step reads well on phone, tablet and desktop.

## Open question

**Should existing users see the tours when this goes live?** The suggestion is no. They can open the tours from Settings if they want.
