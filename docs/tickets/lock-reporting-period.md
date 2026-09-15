# Lock a month when the signed packet comes back

**Priority:** _(set in Notion)_

---

## Background

Each month the team downloads the packet, sends it to the City, and presses **Mark as submitted** on the Month-End Packet tab. The City reviews it and sends back a signed, approved copy.

Today:

- The app has nowhere to keep that signed copy.
- A finished month can still be changed by mistake. Editing an expense in a submitted month only shows a warning, and Save still works.
- Nothing shows which months are settled and which are still open.

## Goal

When the signed packet arrives, the team locks that month. Locking:

- saves the signed copy with the month
- marks the month as **Reconciled**
- stops the month's expenses from being changed

If the City asks for a correction, the team unlocks the month, makes the fix, downloads a fresh packet, and locks the month again with the new signed copy.

Each funding source locks its months separately. Locking March for one funding source doesn't lock March for another.

---

## The three states of a month

**Open → Submitted → Reconciled**

- **Open:** nothing has been sent yet.
- **Submitted:** someone pressed "Mark as submitted". This already exists and doesn't change.
- **Reconciled:** someone locked the month and uploaded the signed copy.

Locking is always something a person does. Nothing locks on its own. Admins and managers can both lock and unlock.

---

## 1. Locking a month (Month-End Packet tab)

Add a **Lock month** button next to "Mark as submitted" (or next to "Submitted 04/08/2026" once it's marked).

Pressing it opens a dialog:

- **Title:** "Lock March 2026?"
- **Text:** "Upload the signed packet from the City. Once locked, this month's expenses can't be changed until someone unlocks it."
- A file picker for the signed copy (PDF only).
- Buttons: **Lock month** and **Cancel**. Lock month stays disabled until a file is chosen.

Rules:

- **Missing documents:** you can't lock while the red "This packet cannot be downloaded yet." message is showing. The button is disabled and says: "Add the missing documents before locking this month."
- **Not yet submitted:** if nobody marked the month as submitted, locking marks it submitted too, with today's date.

After locking, the top of the page shows:

> **Reconciled** · Locked on 04/20/2026 by Misty · View signed packet · Unlock

While the month is locked:

- The "Undo" link for Submitted is hidden.
- The month documents section has no Add or Remove.
- Downloads still work.

---

## 2. What a locked month protects

For that funding source and month, nobody can:

- add a new expense to it, including picking that month in the Add Expense form
- edit one of its expenses, including attaching or removing files
- move an expense into it or out of it (changing the month or the funding source)
- delete one of its expenses
- restore or permanently delete one of its expenses from Trash
- press "Add to Mar" or "Remove" for it on the Recurring tab
- add or remove month documents

People can still view everything, download the packet, the Excel summary and cover sheets, and admins can still open History.

When something is blocked, say why and where to go:

> "March 2026 is locked. Unlock it on the Month-End Packet tab to make changes."

Examples:

- **Opening a locked expense:** the page shows the message at the top, the fields can't be changed, and there's no Save button.
- **Expenses tab:** Delete is disabled for rows in a locked month.
- **Recurring tab:** "Add to Mar" is disabled with the message.
- **Expense form:** choosing a locked month when adding or editing an expense shows the message, and Save is refused.

The block must still hold if someone had a page open before the month was locked. For example, Usman has an expense's edit page open, Misty locks March, and then Usman presses Save. The save is refused with the message above.

**Not part of this ticket:** line items, performances, funding source settings and other months stay editable, even though they can change a locked month's figures. The Dashboard's existing "March 2026 has changed since it was submitted" notice already covers that.

---

## 3. Unlocking a month

Pressing **Unlock** opens a dialog:

- **Title:** "Unlock March 2026?"
- **Text:** "Its expenses can be changed again. The signed copy stays saved. Lock the month again when the new signed copy arrives."
- **Reason (optional):** for example, "City asked us to remove the duplicate Staples invoice."
- Buttons: **Unlock** and **Cancel**.

After unlocking:

- The month goes back to **Submitted**, not Open.
- The team makes the correction, downloads a fresh packet, and presses **Lock month** again with the new signed copy.
- The new signed copy becomes the current one.
- Earlier signed copies are never deleted. They stay downloadable, labelled "Replaced on 05/02/2026".

---

## 4. Month list (Contract Summary tab)

Add a **Reporting periods** section for the selected funding source. List every month that has expenses, or has been submitted or locked, newest first.

| Month | Status | Details |
|---|---|---|
| April 2026 | Open | — |
| March 2026 | Submitted | Submitted 04/08/2026 |
| February 2026 | Reconciled | Locked 05/02/2026 by Misty · View signed packet |
| January 2026 | Reconciled | Locked 02/25/2026 by Awais · View signed packet |

Under a month that was unlocked and locked again, show what happened, oldest first:

- Locked 03/20/2026 by Misty · View signed packet (replaced)
- Unlocked 04/28/2026 by Awais — "City asked us to remove the duplicate Staples invoice"
- Locked 05/02/2026 by Misty · View signed packet

The Month-End Packet tab shows the same details for the month selected in the header: the current signed copy, earlier copies, and unlock reasons.

---

## 5. Tour text

The Month-End Packet tour's last step still says: "Mark the month as submitted once it's sent. You can still correct it later."

Change it to: "Mark the month as submitted once it's sent. When the signed copy comes back, lock the month so nothing changes by accident."

---

## Done when

- A month with no missing documents can be locked with a signed PDF. It then shows as Reconciled on both the Month-End Packet and Contract Summary tabs.
- A month with missing documents can't be locked, and the reason is shown.
- Locking a month that wasn't submitted also marks it submitted.
- Every action in section 2 is blocked for a locked month, with the message. This includes a page that was already open before the lock.
- Viewing and all downloads still work for a locked month.
- Locking March for one funding source doesn't affect March for another.
- Unlocking works with or without a reason, and the reason shows in the history.
- After unlock → fix → lock again, both signed copies can be downloaded and the newest is marked current.
- The Reporting periods list shows Open, Submitted and Reconciled correctly.
- Screens look right on phone, tablet and desktop.

## Open questions

1. **Locking again after a correction.** Should the "Submitted" date and the Dashboard's "changed since it was submitted" comparison move to the corrected month? The suggestion is yes. Otherwise the Dashboard keeps saying March changed, even after the City signed the corrected packet.
2. **Archived funding sources.** Can their months still be locked and unlocked? The suggestion is yes, because a funding source's last months often come back signed after it has ended.
