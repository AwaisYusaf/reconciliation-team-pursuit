# AI monthly summary

**Priority:** _(set in Notion)_

**Build after:** Admin dashboard (plans) and Read amounts from uploaded receipts (OpenAI setup). This ticket uses both.

---

## Background

Every month, after the packet is done, the team also writes about the month in their own words: monthly activity reports, updates for funders and the board, internal notes, and notes for audits. They build these by hand from the same expenses, descriptions and narratives already in the app.

Today the app has nowhere to write or keep that kind of summary.

## Goal

On the Month-End Packet tab, the team presses one button and gets a **draft summary** of the month, written from what they entered. They review it, edit it freely, and it's saved with that month. They can copy it or download it as Word to use in their own reports.

- It's a drafting aid. It's never sent anywhere or added to the packet on its own.
- It's only available to organizations on the **Reconciliation + AI** plan.

---

## 1. Who can use it

- Only organizations on the **Reconciliation + AI** plan. The plan is set in the Admin dashboard.
- Admins and managers can both use it.
- Organizations on "Reconciliation" see the section with a short note instead of the button: "Monthly summaries are part of the Reconciliation + AI plan."
- Use the same "is this organization allowed?" check built for receipt reading, with the plan added.
- If the OpenAI key isn't set on the server, the section is hidden.

**For launch:** Awais sets Team Pursuit to "Reconciliation + AI" (still Complimentary) in the Admin dashboard so Misty gets it.

---

## 2. Where it lives

A new **Monthly summary** section on the **Month-End Packet** tab, below Month documents.

- **One summary per funding source per month**, following the header, just like the packet. March 2026 for the City contract and March 2026 for a Foundation grant each have their own.
- When the header is on "All", the section says: "Pick a funding source to write its monthly summary."
- The summary is **not** part of the packet. It doesn't appear in "Packet contents", the download, the page numbers or the outline.

---

## 3. Writing the first draft

**Before any summary exists** the section shows:

- **Text:** "Write a draft summary of March 2026 from this month's expenses, descriptions and narratives. You can edit everything before using it."
- A button: **Write draft summary**

The button is disabled when the month has no expenses, with the text: "Add expenses to this month first."

The summary can be written at any time; the month doesn't have to be complete. Missing receipts or proofs don't block it.

**While writing:** "Writing your summary… this can take up to a minute." The rest of the page keeps working.

**If it fails:** "The summary couldn't be written right now. Please try again." Nothing is saved.

---

## 4. What the summary contains

The summary always has these sections, in this order:

1. **Overview**: two or three sentences on the month: total spent, number of expenses, and the main things the money went to.
2. **Spending by line item**: for each line item with spending, the amount and what it was used for, based on the descriptions and narratives.
3. **Budget position**: for each line item, spent this month, spent to date and remaining, plus the overall contract figures.
4. **Changes from last month**: line items that went noticeably up or down compared with the previous month, with the amounts.
5. **Items to note**: expenses with no receipt (and the reason given), refunds, and any tax or fees not reimbursed.

**Example (Overview):**

> In March 2026, Team Pursuit spent $48,210.35 across 41 expenses on the City of Detroit contract. Most of it went to Salary ($31,400.00 for 6 staff) and Community Program Support ($9,850.00), including supplies and catering for community events.

**Rules for the writing:**

- **Only facts from the app.** Every amount, name and count must come from the month's records. Numbers must match the Dashboard and Contract Summary exactly.
- **Never invent results.** For example, it must not write "reached 84 young adults" or "held 4 events" unless a description or narrative says so.
- **Placeholders for missing context.** Where a report would normally need something the app doesn't know, leave a clear placeholder in square brackets, such as "[Add number of participants]", for the user to fill in.
- **Plain, professional tone**, suitable for a funder or board, with no marketing language.
- **Amounts** use the app's money format: $1,234.56.

---

## 5. Reviewing and editing

After it's written, the section shows the summary in an editor:

- Headings, paragraphs and bullet lists can be edited like a normal document.
- **Save changes** saves the edit. Leaving the page with unsaved changes asks first.
- Under the title: "Draft written 16 Sep 2026 · Last edited 17 Sep 2026 by Misty Smith"
- A reminder above the text: "This is a draft written by AI from your records. Check every figure and fill in anything in [brackets] before using it."

**Buttons:**

- **Copy text** copies the summary so it can be pasted into an email or another document.
- **Download Word** downloads it as a Word file named like the other documents: `Team Pursuit March 2026 Monthly Summary.docx`. When the organization has more than one funding source, the source name is added: `Team Pursuit City of Detroit March 2026 Monthly Summary.docx`.
- **Write again** writes a fresh draft from the current records. It first confirms: "Replace this summary with a new draft? Your edits will be lost."

**Records changed since the draft:** if an expense in that month is added, edited or deleted after the summary was written, show a notice: "Expenses in March 2026 have changed since this summary was written. Write again to include the changes, or edit the text yourself." Editing the summary doesn't make the notice go away; only writing it again does.

---

## 6. Locked (Reconciled) months

Viewing, **Copy text** and **Download Word** always work.

Editing and **Write again** follow the open question below.

---

## 7. Writing service (OpenAI)

- **Model:** OpenAI **gpt-5.6-terra**. It writes better and sticks to facts more closely than the cheapest model, at about 5–6 cents per summary.
- **The model name is a server setting**, separate from the receipt-reading model, so either can be changed without a release.
- **The same OpenAI key** as receipt reading is used, and OpenAI is asked not to store the request.
- **Only the month's text and figures are sent.** No receipts, images or files.
- **Figures are worked out by the app** using the same numbers as the Dashboard and Contract Summary, and passed to the model. The model never adds anything up itself.
- **Each run is logged** in the same usage log as receipt reading: organization, month, success or failure, and cost.

---

## Not part of this ticket

- Adding the summary to the packet (needs Misty and the City to agree first)
- Different summary types (funder, board, audit) or choosing tone and length
- Sending or emailing the summary
- Summaries across several months, a quarter or all funding sources together
- Program results the app doesn't record (participants, events)
- Keeping older versions after "Write again"

---

## Done when

- **Plan access:** only organizations on Reconciliation + AI can write a summary. Others see the plan note.
- **Writing a draft:** a month with expenses produces a draft with all five sections. A month with none can't.
- **Figures are exact:** every figure in the draft matches the Dashboard and Contract Summary for that funding source and month.
- **Nothing invented:** tested on at least 3 real-style months, with no invented results or amounts. Missing context shows as [bracket] placeholders.
- **Editing:** edits save and stay after a refresh, with "Last edited" and who did it.
- **Copy and download:** Copy text works. Download Word opens correctly in Word and Google Docs, with the right file name.
- **Write again:** it asks first, then replaces the draft.
- **Changed-records notice:** it appears after an expense in that month is added, edited or deleted.
- **Per funding source:** each source's month has its own summary. "All" asks for a source.
- **Not in the packet:** the packet download is unchanged.
- **Failures:** a failed run shows the message and saves nothing.
- **Usage log:** each run is logged with cost.
- **Screens:** they look right on phone, tablet and desktop.

## Open questions

1. **Locked months.** Can the summary still be edited and rewritten after a month is locked? The suggestion is yes. It isn't part of what the City signed, and audit notes are often written after reconciliation.
2. **Dashboard shortcut.** Should the Dashboard show a small "Monthly summary ready" link once one exists? The suggestion is not for now.
