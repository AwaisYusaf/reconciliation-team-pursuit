# m10 — Admin Dashboard

## Purpose
AB Solutions staff's own view of every customer organization: plan, subscription status,
complimentary access and suspension, at a glance and per-organization, with a full history of
who changed what and when.

## Scope
Routes `/a` (directory) and `/a/orgs/[id]` (one organization). Staff-only — gated by
`requireStaffPage()` (Phase 9 §3.6, D-98), which also covers the layout. No customer, including
an organization's own admin, can reach either route. Read view plus four staff actions (change
plan, complimentary access, suspend, reinstate) that write an `org_account_events` row each.
Desktop and tablet only; no tours.

## Data
Reads `src/modules/admin/queries.ts`'s five read models (`loadOrgDirectory`, `loadOrgAccount`,
`loadOrgUsers`, `loadOrgUsage`, `loadOrgHistory`) and the pure helpers in
`src/modules/admin/directory.ts` (`complimentaryState`, `summarize`, `filterOrgs`,
`describeAccountEvent`, `toggleFilterValue`). Writes go through the four `"use server"` actions
in `src/modules/admin/actions.ts` — this module adds no new server logic beyond the screens
themselves.

## Behavior
- **Directory (`/a`)**: three rows of summary cards (By plan, By status, Other), always counted
  over every organization regardless of the table's own filter (Phase 9 §7 Q10). Clicking a card
  sets the matching filter; clicking the active card again clears it
  (`toggleFilterValue`). A search box and two `Select`s narrow the same list, all combined with
  AND. The table shows Organization · Signed up · Plan · Status (+ badges) · Users · Last
  sign-in, newest signup first, with a row count line above it and a "No organizations match
  these filters." empty state. Each organization name is a real link to its own page.
- **Organization page (`/a/orgs/[id]`)**: a non-uuid or unknown id renders `notFound()`.
  Account details (name, doc name, signed up, setup finished, plan/status/badges, a users
  table), a Usage card (funding sources, expenses, last expense, a storage bar, months
  submitted/locked, packets downloaded), the four action dialogs, and a History list — newest
  first, with "Organization signed up" always last since it isn't a real event row.
- **Complimentary badge**: no end date → "Complimentary"; a future or today's end date →
  "Complimentary until {date}"; a past end date → "Complimentary (ended {date})" in the warning
  tone (Phase 9 §7 Q5, Q6).
- **The four actions**: each opens an overlay (two `Modal`s, two `Dialog`s), shows a refusal
  inside the overlay rather than as a toast, and on success calls `reportResult` +
  `router.refresh()` — the same pattern as `month-lock.tsx`'s lock/unlock dialogs.

## Acceptance
Only staff reach either route (Phase 9 P1 tests + a manual customer-admin check). The directory's
summary counts equal `filterOrgs` over the same criteria (P3 unit test, since `summarize` is
defined in terms of `filterOrgs`). Search, plan/status filters and summary-card clicks all narrow
the table the same way. An organization's Usage numbers match the read models proven in P3.
Every one of the four actions shows up in History with who, when, and the reason/note (P2 action
tests). Screens hold together at 1280px and 768px.

---

## Claude Design prompt

```
Design the AB SOLUTIONS ADMIN screens — a staff-only dashboard, not the customer app. Header:
"AB Solutions admin" (serif, bold, #211B16) with the staff member's name ("Awais Malik") in
13px #5B5147 beneath it; a secondary "Log out" button on the right. No month or funding-source
selectors, no tab row.

### Screen 1 — Organizations

h1 "Organizations", subtext "Every organization on the app, its plan, status and access."

Three rows of small bordered white cards (13px #5B5147 label / 20px bold value, like the
Expenses summary cards), each row with its own 16px serif sub-heading:
- "By plan": "Reconciliation 7" · "Reconciliation + AI 2"
- "By status": "Trial 3" · "Active 5" · "Past due 1" · "Cancelled 0"
- "Other": "Complimentary 2" · "Suspended 1"

The active card (if any) carries a #5B3A29 ring border. Below: a "Search organizations" input, a
"Filter by plan" select, a "Filter by status" select. A "9 organizations" line above the table.

Table, uppercase headers: Organization | Signed up | Plan | Status | Users | Last sign-in.

Team Pursuit Global      16 Aug 2026   Reconciliation        Active · Complimentary          3   15 Sep 2026
Eastside Youth Alliance  2 Sep 2026    Reconciliation + AI   Past due · Suspended            1   9 Sep 2026
Riverside Arts Coalition 28 Aug 2026   Reconciliation        Trial                           2   Not recorded yet

Status badges are rounded pills: Active in #EAF3EC/#2F4F3E, Past due and an ended
complimentary date in a warm amber wash, Suspended in #F6E7E4/#8A2A22, everything else a
neutral outline pill. Organization names are underlined accent links.

### Screen 2 — Organization page (Eastside Youth Alliance)

h1 "Eastside Youth Alliance". A card with a two-column definition list: "Name printed on
documents" (Eastside Youth), "Signed up" (2 Sep 2026), "Setup finished" (2 Sep 2026), "Plan &
status" (Reconciliation + AI · pill row: Past due · Suspended). Below it, a small users table:
Name | Email | Role | Last sign-in, one row "Misty Chen · misty@eastside.org · Admin · 9 Sep
2026".

A Usage card: "Funding sources" "2 active, 1 archived", "Expenses" "142 total · 12 in September
2026", "Last expense added" "9 Sep 2026", a labelled storage bar (#F1ECE2 track, #5B3A29 fill)
reading "212 MB of 5 GB" at about 4% fill, "Months submitted · locked" "5 · 3", "Packets
downloaded" "4" with a small helper line "Counts each packet the first time it was downloaded."

An Actions card: four outline buttons in a row — "Change plan", "Complimentary access",
"Suspend" (only one of Suspend/Reinstate shows). Show the Suspend dialog open: red-bordered
panel, title "Suspend Eastside Youth Alliance?", body text about signing everyone out, a
required "Reason" textarea filled with "Payment 30 days overdue", "Suspend" (red-bordered) and
"Cancel" buttons.

A History card, newest first, thin dividers between lines:
"15 Sep 2026, 10:42 – Awais suspended access – Payment 30 days overdue"
"8 Sep 2026, 09:10 – Awais changed plan from Reconciliation to Reconciliation + AI"
"2 Sep 2026 – Organization signed up"
```
