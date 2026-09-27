# Feature requests: customers suggest ideas, see what others asked for, and our team replies

**Priority:** _(set in Notion)_

---

## Background

Customers need a way to ask for things before launch. Today the only way is to email tech@teampursuit.org, which a few messages in the app mention. Requests get lost in email, a customer can't see what others have already asked for, and the same idea arrives many times.

## Goal

- Any user can suggest a new feature, an improvement or an idea from inside the app, **as text only**.
- Every suggestion arrives in the admin dashboard (`/a`). Our team reads it there, replies below it, and sets its status.
- Customers see the requests other customers have made, once our team has approved them, and add their vote with **"I want this too"**.

Our team checks the admin dashboard for new requests. Nothing is emailed or sent anywhere else.

---

## 1. Where customers find it

Add **"Feature requests"** to the avatar menu (top right), between "Your profile" and "Sign out". It opens the Feature requests page.

- Admins and managers both have it, on every paid plan, complimentary included.
- An organization without a paid plan only sees the plan chooser, so it doesn't get the item. Its "Questions about your plan? Email …" line stays as it is.

## 2. The Feature requests page

- **Title:** "Feature requests"
- **Intro line:** "Tell us what would make Stay Funded 360 work better for you. Our team reads every request and replies here."
- **Button:** "Suggest a feature" (section 3)
- **Search box:** "Search requests". It searches titles and details, so a user can check whether their idea was already asked for.
- **Two tabs:**
  - **"All requests"**: every request our team has approved (from any organization), plus this organization's own requests.
  - **"From your organization"**: only this organization's requests, including ones still waiting for review.

Requests with the most votes come first. Equal votes: newest first.

Each request in the list shows:

> **Split one receipt across two funding sources**
> Some invoices pay for both of our grants. We'd like to enter the receipt once and say how much goes to each…
> Planned · 7 votes · Suggested 03/12/2026
> **I want this too**

- The details are cut to two lines in the list.
- This organization's own requests carry a small "Your organization" label.
- A request still waiting for review also says "Only your organization can see this until our team reviews it."
- When our team's reply is the newest one on a request, the row says **"Our team replied"**.

**I want this too:**
- One vote per person. Pressing it again takes the vote back; while voted, the button reads "You want this".
- The person who suggested a request has a vote on it from the start.
- Released and Not planned requests show their votes but no button.

Nothing updates live. New requests, votes and replies appear when the page is opened or reloaded.

## 3. Suggesting a feature

**Suggest a feature** opens a dialog:

- **Title:** "Suggest a feature"
- **"What would you like?"**: required, up to 100 characters. Placeholder: "For example: Remind us when receipts are missing before month end"
- **"Tell us more"**: required, up to 2,000 characters. Help text: "What are you trying to do, and how would it help your team?"
- **Buttons:** "Send request" and "Cancel"

Text only: no images or files.

After sending:
- A toast says "Thanks. Your request was sent to our team."
- The request appears at the top of "From your organization" as "Waiting for review".
- Other organizations can't see it until our team approves it (section 6).

One person can send at most 10 requests a day. The 11th shows: "You've sent a lot of requests today. Please try again tomorrow."

Example: Misty suggests "Remind us when receipts are missing before month end". Her manager Tasha sees it at once under "From your organization". Another customer doesn't see it until our team approves it.

## 4. Opening a request

Clicking a request opens it on its own page, with a back link to the list.

**A request from your own organization** shows:
- the title, the full details, the status and the votes
- "Suggested by Misty on 03/12/2026"
- **Replies**, oldest first. Each reply shows who wrote it and when. Our team's replies are signed "Stay Funded 360 team", never with the staff member's own name.
- An **"Add a reply"** box with a "Send reply" button, up to 2,000 characters. Anyone in the organization can reply, so a question from our team can be answered.

**A request from another organization** shows only the title, the details, the status and the votes. It never shows which organization or person asked, and it never shows replies.

Example:
1. Our team replies to Misty's request: "Thanks, Misty. Should the reminder come three days or a week before month end?"
2. Her list now says "Our team replied".
3. She opens the request and replies "Three days, please."

## 5. Statuses

| Status | What it tells the customer |
|---|---|
| Waiting for review | Just sent. Our team hasn't looked at it yet. |
| Considering | Our team is thinking about it. |
| Planned | It will be built. |
| In progress | It's being built now. |
| Released | It's in the app now. |
| Not planned | It won't be built. A reply says why. |
| Already requested | Someone asked for this before. A reply points to the existing request. |

Other organizations see a request only when our team has turned on **"Show to all organizations"** (section 6). "Waiting for review" and "Already requested" are never shown to other organizations.

## 6. Admin dashboard: the Feature requests list

The top of `/a` gets two links: **"Organizations"** (today's list) and **"Feature requests"**. Feature requests carries a count of requests that need attention. A request needs attention when:
- it's waiting for review, or
- the customer has replied since our team last replied.

The Feature requests list:
- Newest first. Filters for status and "Needs attention", and a search box.
- **Columns:** Request (title) · Organization · Suggested by · Date · Votes · Status · Shown to all (Yes/No).
- Ten per page, with the same pagination as the organizations list.

## 7. Admin dashboard: one request

Opening a request in `/a` shows:
- the title and details, the organization (a link to its page), who suggested it (name and email) and when
- **Edit:** staff can reword the title and details, for example to remove a name or a figure before showing the request to everyone. The customer's own organization sees the edited version too. If it was edited, the customer's original wording stays visible to staff under "Original wording".
- **Status:** a choice from the list in section 5.
- **"Show to all organizations"** switch, off to start with, and help text: "Other organizations see only the title, details, status and votes. They never see who asked or any replies." Staff can't turn it on while the status is Waiting for review or Already requested.
- **Votes:** "7 votes from 4 organizations", with the organization names (staff only).
- **Replies:** the same conversation the customer sees, and a box "Reply to Team Pursuit" with a "Send reply" button.

Replying, or moving a request off Waiting for review, clears "Needs attention".

Example of a duplicate:
1. A second customer suggests "Reminder for missing receipts".
2. Staff set it to Already requested and reply: "This is already on the list as 'Remind us when receipts are missing before month end'. Press I want this too on it to add your vote."

## 8. Admin dashboard: the organization page

`/a/orgs/[id]` gets a **"Feature requests"** card listing that organization's requests (title, status, date), each linking to the request in section 7. It shows "No feature requests yet." when there are none.

---

## Good to know

- Everything is plain text. A web address typed into a request or reply shows as text, not as a link.
- Other organizations never see an organization's name, a person's name, or a reply.
- If a user is removed from the organization, their requests, votes and replies stay.
- If an organization is deleted, its requests, votes and replies are deleted with it.
- The support email in the app's other messages stays as it is.

## Not part of this ticket

- Images or file attachments.
- Emails, Slack messages or any other notification about new requests or replies. (Slack for our team comes later.)
- Live updates while a page is open.
- Reporting a problem or asking a question. Those stay on email for now (see open question 1).
- Customers commenting on another organization's request.
- Editing or withdrawing a request after sending it. Add a reply instead.
- Suggesting similar requests while the customer types a title.
- Deleting requests from the admin dashboard.

## Done when

- The avatar menu has "Feature requests" for admins and managers on a paid plan, and it opens the Feature requests page.
- A user can suggest a feature with a title and details (text only). It appears straight away under "From your organization" as Waiting for review.
- Another organization can't see a request until staff turn on "Show to all organizations", and never sees a Waiting for review or Already requested one.
- Another organization sees only the title, details, status and votes: never who asked, which organization, or the replies.
- "I want this too" adds one vote per person, and pressing it again takes the vote back. The person who suggested a request has a vote from the start.
- Search finds requests by words in the title or details. The two tabs show the right requests.
- A new request appears in `/a` → Feature requests, and the link's count goes up.
- Staff can edit the wording, change the status, turn "Show to all organizations" on and off, see which organizations voted, and reply.
- A staff reply is signed "Stay Funded 360 team" and makes the row say "Our team replied". A customer reply puts the request back into "Needs attention".
- The organization page in `/a` lists that organization's requests.
- The 11th request in a day from one person is refused with the message in section 3.
- A user from one organization can never open, vote on or reply to another organization's request that isn't shown to all, even by typing its address.

## Open questions

1. **Problems and questions.** Misty's note says "customer support/request submission". This ticket covers feature requests and ideas only; problems and questions stay on email. _Suggestion:_ show Misty this first version. If she wants problems in the app too, add a "What is this about?" choice later ("A new feature or idea", "Something isn't working"), where problems stay private to the organization.
2. **Where the entry sits.** Avatar menu only, or also a tab in the top bar? _Suggestion:_ avatar menu only. The bar already has nine tabs, and this isn't a daily task.
3. **Vote counts.** Show customers the number of votes, or only the status? _Suggestion:_ show the number. It tells them their vote counted.
4. **Signing replies.** "Stay Funded 360 team", or the staff member's first name? _Suggestion:_ the team name, so the conversation doesn't depend on who is on shift.
