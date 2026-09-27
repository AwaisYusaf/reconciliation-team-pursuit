# Phase 17: Feature requests

**Status (2026-09-27): planned, building on `implementation/feature-requests`.** The plan was
written from the code and reviewed against it under seven lenses (tenancy, database, simplicity,
usability, edge cases, Next 16, tests). §10 lists what the review changed. Awais answered the four
product questions it raised (§2.1). The ticket is Appendix A, word for word.

---

## 1. What this is, in one paragraph

Customers can suggest a feature, an improvement or an idea from inside the app, as plain text.
Every suggestion lands in the staff dashboard (`/a`), where our team reads it, replies below it,
edits its wording if needed, and sets its status. Other organizations see a request only once
staff turn on **Show to all organizations**, and then only its title, details, status and votes,
never who asked or any reply. Anyone can add their vote with **I want this too**. Nothing is
emailed, nothing updates live, and the entry point is one item in the avatar menu.

---

## 2. Decisions

### 2.1 Changes to Appendix A (Awais, 2026-09-27)

| # | Appendix A says | Changed to |
|---|---|---|
| Q1 | "Requests with the most votes come first" (both tabs) and "appears at the top of From your organization" | **All requests**: most votes first, then newest. **From your organization**: newest first, so a request just sent is always at the top |
| Q2 | "Needs attention" when waiting for review or the customer replied since our team last replied; "Replying, or moving a request off Waiting for review, clears" it | When the customer wrote last, the request **stays in Needs attention until staff reply**, even after a status change. A staff reply on a waiting request clears it. With no replies at all, it needs attention while it is waiting for review |
| Q3 | Released and Not planned show votes but no button | **Already requested** also has no button: the staff reply points to the original request, which is where the vote belongs |
| Q4 | A waiting request says "Only your organization can see this until our team reviews it." | Kept. Any other request of your own that other organizations can't see says **"Only your organization can see this."** |
| C1 | Dates as `03/12/2026` | The app's own format, `3/12/2026` (`formatDateUS`), as on every other screen |

### 2.2 Taken by this plan

| # | Decision | Why |
|---|---|---|
| P1 | Visibility is **one SQL predicate**, `visibleTo(orgId)`: `org_id = me OR shown_to_all_at IS NOT NULL`. A database CHECK makes "shown" unstorable while the status is Waiting for review or Already requested, and a status change to either clears it in the same UPDATE | One supplier. "Never shown to others" is unrepresentable rather than merely unqueried |
| P2 | **Needs attention** and **Our team replied** are derived from the newest reply by one SQL fragment. Needs attention = `coalesce(NOT <newest reply is staff>, status = 'waiting_for_review')` | Replies are append-only, so there is no second write path to keep in step (Q2) |
| P3 | Author, voter and reply-author links to `users` are **nullable, `ON DELETE SET NULL`**; every table cascades from `organizations` | The ticket: a removed user's rows stay, an organization's rows go with it. The repo's standard "who did this" FK (`expense_drafts`, `shared_links`). A NOT NULL link would make the Users page offer Delete and then refuse it (D-120) |
| P4 | A vote's `org_id` is the **voter's** organization | Deleting organization B removes B's votes on A's requests, and staff get "from N organizations" without a join through `users` |
| P5 | The limit of 10 a day is counted **in the database**, per author, per America/Detroit day (`todayIso()`), under `pg_advisory_xact_lock` | The in-memory limiter resets on restart and has no calendar day. The lock follows `withOrgUploadLock` |
| P6 | Customer search is a `next/form` GET form (hidden `tab`, a Search button, no debounce). It matches **every typed word** in the current title and details (escaped ILIKE), **never the original wording** | No client component and no second URL builder. Searching the original would find a name staff removed |
| P7 | The customer list shows up to **100 rows** (fetches 101) with "Showing the first 100. Search to find others." `/a` pages ten at a time with the pagination bar moved out of `app/a/page.tsx` into `src/components/ui/pagination.tsx` | Paging a list sorted by votes moves rows between pages; the ticket pages only `/a` |
| P8 | Another organization's rows and the public detail carry **`isOwn: false` and nothing else about ownership**: no org id, author, replies or reply flag. The page title is fixed | Client-component props reach the browser; a per-request `generateMetadata` would print a hidden title |
| P9 | Vote and reply check **in a fixed order**: `isUuid`, then visibility (reply: own organization only), then one fixed refusal for missing or hidden. Only then does vote check that voting is open | A hidden request and a missing one answer identically |
| P10 | Votes are **set, not toggled** (`want: boolean`): insert with `onConflictDoNothing`, delete when false | A double click or a stale second tab can't flip the vote the wrong way |
| P11 | The author's vote is an **ordinary vote**, inserted in the same transaction as the request, and can be taken back | Simplest reading of "has a vote from the start" |
| P12 | A staff edit keeps the customer's wording once, in one UPDATE: `original_title = coalesce(original_title, title)` (and details). A save that changes nothing is refused | A second edit never overwrites the original; Postgres `SET` reads the old row, so no lock |
| P13 | "Request" is allowed in "feature request"; Words rule 4 bans it only in the web-request sense. A removed author's name is left out for customers ("Suggested on …") and reads "Unknown" in `/a` | The ticket's own labels use the word; `UI.invoiceAlreadyAdded` and `admin/directory.ts` precedents |
| P14 | Plain text only: React text, `whitespace-pre-wrap`, long words wrap anywhere, nothing linkified. Runs of whitespace in a title fold to one space on the server | A pasted address must not scroll a phone sideways |
| P15 | The Suggest dialog's text lives in the parent (`Modal` unmounts its content when closed): Cancel keeps it, a successful send clears it. Refusals, including the daily limit, show inside the dialog. No character counter; `maxLength` plus a server refusal as elsewhere | Nothing typed is lost |
| P16 | No change elsewhere: the month and funding-source selectors show on this page as on every `/r` page; no tours; shared requests of a suspended or unpaid organization stay visible, since they carry no names | Existing behaviour |

---

## 3. Data model (one migration, `0042_feature_requests`)

`npm run db:generate -- --name feature_requests`, then hand-edited: header comment, `SET LOCAL
lock_timeout = '5s'` first, CHECKs compare `status::text` (D-115).

Enum `feature_request_status`: `waiting_for_review`, `considering`, `planned`, `in_progress`,
`released`, `not_planned`, `already_requested`.

| Table | Columns | Constraints and indexes |
|---|---|---|
| `feature_requests` | `id`; `org_id` → organizations (cascade); `author_user_id` → users (set null); `title`; `details`; `original_title`, `original_details` (nullable); `status` (default `waiting_for_review`); `shown_to_all_at` (nullable); `created_at`, `updated_at` | title 1 to 100 chars; details 1 to 2000; originals both null or both set; shown only when status allows; unique `(id, org_id)`; `(org_id, created_at)`; `(author_user_id, created_at)` |
| `feature_request_votes` | `id`; `request_id` → feature_requests (cascade); `org_id` → organizations (cascade, the voter's); `user_id` → users (set null); `created_at` | unique `(request_id, user_id)` (NULLs distinct, so a removed person's vote still counts); `(org_id)`; `(user_id)` |
| `feature_request_replies` | `id`; `request_id` + `org_id` → `feature_requests(id, org_id)` (cascade); `org_id` → organizations (cascade); `from_staff` (no default); `author_user_id` → users (set null); `author_staff_id` → staff_users (set null); `body`; `created_at` | body 1 to 2000; one-way `from_staff OR author_staff_id IS NULL` and `NOT from_staff OR author_user_id IS NULL` (a SET NULL never breaks them); `(request_id, created_at)`; `(org_id)`; `(author_user_id)` |

---

## 4. How it works

### 4.1 Server surface

| File | Holds |
|---|---|
| `src/domain/feature-requests.ts` (pure) | Limits; `votingOpen`, `canShowToAll`; URL parse and build for both lists; status checked with `Object.hasOwn` against the labels |
| `src/modules/feature-requests/queries.ts` | `visibleTo`, the newest-reply and needs-attention fragments; the customer list and detail loaders |
| `src/modules/feature-requests/staff-queries.ts` | The `/a` list (count, clamp, `created_at desc, id`), the attention count, one request with votes by organization, an organization's requests (50) |
| `src/modules/feature-requests/actions.ts` | `actionSession()`: `suggestFeatureAction`, `setFeatureRequestVoteAction`, `replyToFeatureRequestAction` |
| `src/modules/feature-requests/staff-actions.ts` | `requireStaff()`: `editFeatureRequestAction`, `setFeatureRequestStatusAction`, `setFeatureRequestShownAction`, `staffReplyToFeatureRequestAction` |
| `src/components/feature-requests/` | The reply thread and reply form (shared by `/r` and `/a`), the vote button |
| `src/components/admin/section-links.tsx` | "Organizations" · "Feature requests (N)", rendered by each `/a` list page (a layout does not re-render on navigation) |

Pages: `/r/feature-requests`, `/r/feature-requests/[id]`, `/a/feature-requests`,
`/a/feature-requests/[id]`, each with a `loading.tsx`, plus `app/a/feature-requests/not-found.tsx`,
and a card on `/a/orgs/[id]`. `ProfileMenu` gains `featureRequestsHref`, passed only by the paid
`/r` shell.

### 4.2 Access

Pages call `pageSession()` (paid and complimentary organizations; unpaid ones reach only the plan
chooser), customer actions `actionSession()`, staff pages `requireStaffPage()` and staff actions
`requireStaff()`. `guard-coverage.test.ts` enforces the first two and gains a check that every
`app/a/**/page.tsx` calls `requireStaffPage`.

---

## 5. Edge cases → handling

| Case | Handling |
|---|---|
| Another organization opens, votes on or replies to a hidden or unknown id | The same `notFound()` or the same refusal (P9) |
| Staff hide a request while another organization has it open | Its vote is refused; a reload shows the 404. Votes already cast stay |
| Status moved to Waiting for review or Already requested while shown | The same UPDATE clears the switch; the CHECK refuses the reverse |
| Staff edit while a customer is looking | The new wording shows on reload; the original is kept once |
| Double click on Send or on the vote | Buttons disabled while pending; the vote is idempotent |
| The 11th request, or 12 at once | The advisory lock gives exactly 10 |
| Near Detroit midnight (tests run with `TZ=Asia/Karachi`) | The day is `to_char(created_at at time zone 'America/Detroit')` against `todayIso()` |
| Search of spaces only, or with `%`, `_`, `\` | No filter; escaped; capped at 100 characters |
| A long unbroken word or address | Wraps |
| The author takes back their vote | "0 votes"; "1 vote" is singular |
| A user is revoked or deleted | Rows stay; a deleted author's name is left out ("Unknown" in `/a`) |
| An organization is deleted | Its requests, its votes (on anyone's requests) and its replies cascade |

---

## 6. Build phases (one commit each)

| Phase | What | Status |
|---|---|---|
| 0 | This file | Done |
| 1 | Schema, migration, domain, queries, actions, unit and integration tests | |
| 2 | Customer screens: menu item, list, dialog, vote, detail with replies | |
| 3 | Staff screens: pagination moved, section links, list, detail, organization card | |
| 4 | Docs: m12, m10, data-model, D-127, README, design-language | |
| 5 | Adversarial review, then a Chrome pass at 1280 and 375 px | |

---

## 7. Tests (every "Done when" line)

| Done when | Test |
|---|---|
| Suggest shows under "From your organization" | Top of the org tab: waiting, 1 vote, voted |
| Hidden until shown; never while waiting or already requested | Another organization's list, search, detail, vote and reply all miss it until shown; a raw UPDATE setting it shown while waiting fails (23514); Already requested clears it |
| Others see only title, details, status, votes | Exact key sets on the foreign row and the public detail |
| One vote per person, taken back, author has one | Double add keeps the count; `want=false` lowers it; parallel adds don't error |
| Search | A word in the details found; `%` literal; the original wording not found after an edit (proved to match before) |
| Tabs and sort | All: votes then newest. Org: newest first, including waiting |
| `/a` count and Needs attention | New request +1; staff reply clears; off Waiting clears; customer reply sets it again; customer reply then a status change alone stays flagged (Q2) |
| Staff edit, status, switch, votes by organization, reply | A second edit keeps the first original; the switch refused while waiting; "N from M" right; staff reply has `from_staff` |
| The 11th in a day refused | Exact message; rows either side of Detroit midnight; 12 in parallel give 10 |
| No access by typing the address | Hidden, foreign, random uuid and non-uuid identical |
| Organization page | 50 of 51 plus the capped flag |
| Deletes | A deleted user leaves request, vote and reply with a null author; deleting B removes B's votes on A's requests; deleting A removes all of A's |

Mutation checks, each must fail a test: drop `OR shown_to_all_at IS NOT NULL`; drop the CHECK;
check "voting open" before visibility; add the author to the public loader; drop the ILIKE
escaping; drop the advisory lock; drop the `coalesce` on the original wording.

---

## 8. Strings (UI, in `src/domain/strings.ts`)

The ticket's own wording is used as written: the menu item, page title, intro line, button,
search box, tabs, dialog labels, placeholder and help text, toast, daily-limit message, notes,
"Our team replied", "I want this too" / "You want this", "Stay Funded 360 team", the status
names and their customer descriptions (§5 of the ticket), the admin columns, the switch help text,
"Reply to {organization}" and "No feature requests yet." Everything new is in `UI.featureRequest*`.

---

## 9. Verification

`npm run typecheck`, `npm run lint`, `npm test`, `npm run db:migrate`, then Chrome on
`localhost:3001` (Awais runs the server and signs in) with two organizations and a staff account,
walking every "Done when" line at 1280 and 375 px; the moved pagination on the organizations list.

---

## 10. Plan review (2026-09-27)

A review of the first draft against the code changed: the order of checks in vote and reply, no
ownership data in the page payload, a fixed page title and a guard test for `/a` pages
(tenancy); status parsed without importing the schema and an `org_id` index on replies
(database); customer paging, a search client component and two reply forms cut, and D-128 merged
into D-127 (simplicity); the vote button on your own request, `?back=`, per-tab empty states,
refusals inside the dialog, a toast when a status change hides a request, and wrapping in `/a`
(usability); `revalidatePath` on the literal list path, checked against the Next 16 docs.

---

## Appendix A: Product spec (verbatim)

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
