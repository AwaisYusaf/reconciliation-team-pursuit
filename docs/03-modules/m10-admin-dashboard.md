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
Reads `src/modules/admin/queries.ts`'s read models (`loadOrgDirectory`, `loadOrgSummary`,
`loadOrgAccount`, `loadOrgUsers`, `loadOrgUsage`, `loadOrgAiUsage`, `loadOrgHistory`) and the pure
helpers in `src/modules/admin/directory.ts` (`complimentaryState`, `describeAccountEvent`) and
`src/modules/admin/ai-cost.ts` (`aiCost`, micro-USD formatting). Writes go through the four
`"use server"` actions in `src/modules/admin/actions.ts` — this module adds no new server logic
beyond the screens themselves.

**Every narrowing happens in the database, never in the browser** (D-102): the filter lives in
the URL (`q`, `plan`, `status`, `badge`, `page`) and each read is its own query. Nothing on
either screen renders more rows than it asks for: ten organizations per page
(`ORG_PAGE_SIZE`), ten users with "View all" raising it to `ORG_USERS_MAX`
(`ORG_USERS_PREVIEW`), fifty history lines (`ORG_HISTORY_LIMIT`).

## Behavior
- **Directory (`/a`)**: eight summary tiles in one grid, four across, each captioned with its
  group (Plan / Status / Access) — D-104, chosen over the spec's three labelled rows after the
  client rejected them on sight. Counts come from `loadOrgSummary()` over every organization,
  never the page or the filter (Phase 9 §7 Q10). Each tile is a link that applies its filter,
  and the active one clears it. A search box and two `Select`s narrow the same list, all
  combined with AND; search runs two seconds after typing stops, or immediately on Enter, with
  a line under the box saying which. The table shows Organization (pinned) · Signed up · Plan ·
  Status (+ badges) · Users · Last sign-in, newest signup first, ten per page with a pagination
  bar past that, a row count line above it, and two distinct empty states — "No organizations
  match these filters." when a filter is set, "No organizations yet." when none is. Each
  organization name links to its own page, carrying the current query as `?back=`.
- **Organization page (`/a/orgs/[id]`)**: a non-uuid or unknown id renders `notFound()`, which
  `app/a/not-found.tsx` answers so the way out stays inside `/a`. A chevron back link returns
  to the list the reader came from, filter and page included. Then account details (name, doc
  name, signed up, setup finished, plan/status/badges, the first ten users with "View all"),
  a Usage card (funding sources, expenses, last expense, a storage bar, months
  submitted/locked, packets downloaded), an **AI usage card** (added Phase 11, 2026-09-18 — see
  below), the four action dialogs, and a History list — newest first, with "Organization signed
  up" always last since it isn't a real event row.
- **AI usage card**: every `ai_usage_events` row for the organization, one query grouped by
  `feature` (PHASE-11 §7.6). Receipt reads and monthly summaries are counted as separate tiles,
  not combined, since a summary costs roughly a hundred times what a read does; each tile shows
  the all-time count with a "N in {month}" caption. "Runs with nothing saved" sums `failed` and
  `rejected` outcomes across both features, with a caption noting some of those still used
  tokens. Cost is micro-USD, formatted by `aiCost()` (four decimal places under a cent, the app's
  usual money format at or above it); when any run has token counts but no cost — only possible
  for a run logged before the price env vars were set — the total is flagged as a floor, not the
  real bill. The current month is computed in America/Detroit, matching the card's own month
  label and the organization's timezone rather than UTC.
- **Complimentary badge**: no end date → "Complimentary"; a future or today's end date →
  "Complimentary until {date}"; a past end date → "Complimentary (ended {date})" in the warning
  tone (Phase 9 §7 Q5, Q6).
- **The four actions**: each opens an overlay (two `Modal`s, two `Dialog`s), shows a refusal
  inside the overlay rather than as a toast, and on success calls `reportResult` +
  `router.refresh()` — the same pattern as `month-lock.tsx`'s lock/unlock dialogs.
- **Billing (Phase 16 §4.6)**: once Stripe has seen an organization, a Billing card between AI
  usage and Actions shows our copy of its state (`staffBilling()` in `directory.ts`): Stripe
  status, billed monthly/yearly, "Renews on" or "Ends on", a scheduled change, and warnings for
  a failed payment, an upgrade waiting for payment, collection paused, and a card dispute
  ("Card dispute opened on {date}", from `org_billing.disputed_at`, never cleared); plus "Open in Stripe" (the dashboard customer page, `/test/` for a test
  customer). While billing is on and a subscription is live, Change plan is disabled with
  "Billing for this organization is managed in Stripe." (the server refuses too, P16).
  Complimentary access for a paying organization asks, in the same dialog, whether to cancel the
  paid plan now (no refund, open invoices voided) or at the end of the paid period. Whether it
  pays is asked of Stripe on save (a re-sync first), so if the page's copy was behind, Save
  refuses and the dialog then shows the choice; Stripe is
  cancelled first, and a Stripe failure grants nothing. Suspend pauses collection, reinstate
  resumes it (D3). History lines written by the sync read "Stripe" as the actor.

## Acceptance
Only staff reach either route (Phase 9 P1 tests + a manual customer-admin check). Search, the
plan and status filters, the tile filters and paging all narrow in SQL and are proven against a
26-organization fixture spanning three pages, with the search target deliberately on the last
one — including that `%` and `_` are searched as characters, that a page past the end clamps,
and that the summary counts ignore both the filter and the page
(`queries.integration.test.ts`). An organization's Usage numbers match the read models proven in P3.
Every one of the four actions shows up in History with who, when, and the reason/note (P2 action
tests). Screens hold together at 1280px and 768px.

---

## Claude Design prompt

```
Design the AB SOLUTIONS ADMIN screens — a staff-only dashboard, not the customer app. Header:
"AB Solutions admin" (serif, bold, #211B16) with the staff member's name ("Awais Malik") in
13px #5B5147 beneath it; a secondary "Sign out" button on the right. No month or funding-source
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
downloaded" "4" with a small helper line "Counts each packet the first time it was downloaded or shared." (sharing a packet by link pins it as a download does — PHASE-12 P22)

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
