# Admin dashboard for AB Solutions

**Priority:** _(set in Notion)_

---

## Background

AB Solutions runs this app for every organization that uses it. Today there is no screen to see who those organizations are or to manage their access.

Today:

- The admin area (`/a`) only says "Admin dashboard – Coming soon."
- Any organization's own admin can open it. Misty, for example, can reach it from Team Pursuit's account. It must be for AB Solutions staff only.
- The app doesn't store a plan, subscription status, complimentary access or suspension for an organization.
- Payments (Stripe) aren't connected yet, so everything here is set by hand for now. Stripe will fill in plans and statuses automatically later.

## Goal

AB Solutions staff get their own dashboard where they can:

- see every organization, with its plan and status
- open one organization and see its account details and usage
- suspend and reinstate an organization
- give an organization free (complimentary) access
- change an organization's plan and status by hand
- see totals by plan and by status

Every change is recorded with who made it and when.

---

## 1. Who can open the dashboard

- Only **AB Solutions staff accounts** can open the dashboard. These accounts are separate from customer organizations. They don't belong to any organization and can't see the normal app tabs.
- There's no sign-up for staff accounts. The developer creates them (for example for Awais).
- Staff use the normal login page. After signing in they go straight to the admin dashboard.
- A customer account (admin or manager) that tries to open the dashboard is sent to its own app, as if the page didn't exist. This includes Misty.

---

## 2. Plans and statuses

**Plans** (from the landing page):

- **Reconciliation**, $297/month
- **Reconciliation + AI**, $497/month

For now a plan is only a label. It doesn't turn features on or off.

**Subscription status:** Trial, Active, Past due, Cancelled.

Two extra badges can show next to the status:

- **Complimentary**: free access, with an optional end date
- **Suspended**: access is blocked

**Starting values:**

- Organizations that already exist, such as Team Pursuit Global, start as **Reconciliation · Active · Complimentary** with no end date, so nobody loses access when this ships.
- A new sign-up starts as **Reconciliation · Trial**.

---

## 3. Organizations list (main page)

**Summary at the top** — small cards, one row each:

- **By plan:** "Reconciliation 7" · "Reconciliation + AI 2"
- **By status:** "Trial 3" · "Active 5" · "Past due 1" · "Cancelled 0"
- **Other:** "Complimentary 2" · "Suspended 1"

Clicking a card filters the list below to those organizations.

**Table**, newest sign-up first:

| Organization | Signed up | Plan | Status | Users | Last sign-in |
|---|---|---|---|---|---|
| Team Pursuit Global | 16 Aug 2026 | Reconciliation | Active · Complimentary | 3 | 15 Sep 2026 |
| Eastside Youth Alliance | 2 Sep 2026 | Reconciliation + AI | Past due · Suspended | 1 | 9 Sep 2026 |

- A search box finds organizations by name.
- Filters for plan and status.
- Clicking a row opens that organization's page.

---

## 4. Organization page

**Account details**

- Organization name and the name printed on documents (for example "Team Pursuit Global" / "Team Pursuit")
- Signed up: 16 Aug 2026
- Setup finished: 16 Aug 2026, or "Not finished" if they never completed setup
- Plan, status and badges, for example "Reconciliation · Active · Complimentary until 31 Dec 2026"
- Users: name, email, role (Admin / Manager) and last sign-in for each

**Usage**

- Funding sources: "2 active, 1 archived"
- Expenses: "412 total · 38 in September 2026"
- Last expense added: 14 Sep 2026
- Storage: "212 MB of 500 MB" with a small bar
- Months submitted: 7 · Months locked: 5
- Packets downloaded: 9

Only counts are shown here. Staff can't see the organization's expenses, receipts or documents.

**Last sign-in** isn't recorded today. It starts being recorded when this ships. Before that, it shows "Not recorded yet".

**Actions** (buttons on this page): Change plan, Complimentary access, Suspend / Reinstate.

**History** at the bottom, newest first. For example:

- "15 Sep 2026, 10:42 – Awais suspended access – Payment 30 days overdue"
- "1 Sep 2026, 09:10 – Awais changed plan from Reconciliation to Reconciliation + AI"
- "16 Aug 2026 – Organization signed up"

---

## 5. Change plan

**Change plan** opens a dialog:

- **Plan** dropdown: Reconciliation / Reconciliation + AI
- **Status** dropdown: Trial / Active / Past due / Cancelled
- **Note** (optional), for example "Upgraded after call with Misty"
- Buttons: **Save** and **Cancel**

Save updates the page and adds a line to History. Changing the plan or status never blocks or unblocks the organization. Only Suspend does that.

---

## 6. Complimentary access

**Complimentary access** opens a dialog:

- A checkbox: "Give this organization free access"
- **End date** (optional). Empty means no end.
- **Note** (optional), for example "Pilot partner until year end"
- Buttons: **Save** and **Cancel**

How it shows:

- With an end date: "Complimentary until 31 Dec 2026"
- After the end date passes: "Complimentary (ended 31 Dec 2026)" in a warning color

Nothing happens automatically when the date passes. Staff decide what to do next.

Turning it on or off adds a line to History.

---

## 7. Suspend and reinstate

**Suspend** opens a dialog:

- **Title:** "Suspend Eastside Youth Alliance?"
- **Text:** "Everyone in this organization will be signed out and won't be able to sign in until you reinstate it. None of their data is changed or deleted."
- **Reason** (required), for example "Payment 30 days overdue"
- Buttons: **Suspend** and **Cancel**

After suspending:

- Everyone in that organization is signed out right away. A page they already had open stops working on their next click or save.
- If they try to sign in, the login page shows: "Your organization's access is paused. Please contact support."
- Their data stays exactly as it was.

**Reinstate** opens a simple confirm ("Reinstate Eastside Youth Alliance?") with an optional note. Afterwards, everyone can sign in again and finds everything as they left it.

Both actions add a line to History.

---

## Not part of this ticket

- Connecting Stripe, taking payments or sending invoices
- Plans limiting features, such as the number of funding sources
- Suspending automatically when complimentary access ends or a payment is late
- Viewing an organization's expenses, receipts or documents, or signing in as a customer
- Creating, editing or deleting customer organizations or their users from the dashboard
- Emails to organizations (for example, a "you've been suspended" email)
- Changing the pricing on the landing page

---

## Done when

- Only AB Solutions staff accounts can open the dashboard. Customer admins and managers, including Misty, can't.
- The list shows every organization with signup date, plan, status and badges, and the summary counts match the list.
- Search, filters and clicking a summary card all narrow the list correctly.
- An organization's page shows its account details and usage, and the numbers match what is in that organization's app.
- Changing the plan or status works and shows in History.
- Complimentary access can be turned on with or without an end date, and an ended date shows as ended.
- Suspending signs everyone in that organization out and blocks sign-in with the message. Reinstating lets them back in with nothing changed.
- Suspending one organization doesn't affect any other organization.
- Every change shows in History with who made it, when, and the reason or note.
- Existing organizations start as Reconciliation · Active · Complimentary, and new sign-ups start as Reconciliation · Trial.
- Screens look right on desktop and tablet.

## Open questions

1. **Support contact on the suspended message.** Which email or phone should "Please contact support" show? The suggestion is to add the AB Solutions support email once you confirm it.
2. **Can staff suspend an organization that is mid-month?** The suggestion is yes, with no extra warning. The reason field and History are enough, and their data isn't touched.
