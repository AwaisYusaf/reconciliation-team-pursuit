# Phase 16: Paying for a plan with Stripe

**Status (2026-09-26): building. Phases 0 to 5, 6 core and 7 committed** on
`implementation/payment-gateway` (`15eb0ff` Phases 0 and 1, `d8228b9` Phase 2, `ea055f9` Phase 3,
`3c17f64` Phase 4, `a7af57c` Phase 5, `f95f68f` Phases 6 core and 7 with the first test run's
changes), all behind `BILLING_ENABLED`, which stays off. The rest of Phase 6 (queued-downgrade
refusal, archive from the plan page) is still to build. Phase 8 (go-live) is last. Phases 4 and 5
were renumbered on 2026-09-25 to follow the build order: "no free use" was Phase 5 in the first
draft and the screen was Phase 4.

**PR #23 review fixes (2026-09-26, branch `review/pr-23-fixes`):** the lockfile is back in sync
with package.json (the Docker build failed); the Stripe copy moved into `org_billing`, read only in
the configured Stripe mode (D-125, §3); syncs order themselves by when they read Stripe, across
processes; a deleted Stripe customer is replaced at Checkout and an unknown one never is; Stripe
requests time out after 10 s and the layout's re-sync runs after the page is sent; schedule
rewrites keep a trial and a downgrade's `phase_start`; staff Change plan clears a pinned free
plan; a staff complimentary grant asks Stripe whether the org pays; a plan on hold is fixed from
`/r/plan` (D-126); the queued-downgrade refusal and archiving from the plan page are built (Phase
6); the paywall allow-list names exact entries; nothing about billing shows while it is off.
Migration `0041` was regenerated: a database that applied the old one must be restored to `0040`
first.

**Renumbered when `main` was merged in (2026-09-26):** this plan was written as Phase 15, but
`main` used Phase 15 for the PR #21 follow-ups (`PHASE-15.md`), so it is Phase 16. Its decisions
D-119, D-120 and D-121 became **D-122, D-123 and D-124** (main had used the first three), and its
migration `0039_stripe_billing` became **`0041_stripe_billing`** (main added `0039` and `0040`),
now starting with `SET LOCAL lock_timeout = '5s'` like theirs. Commit messages and chat before
that date use the old numbers.

Written after a working reference build (§12)
was tested against a real Stripe sandbox; everything marked **Proven** was observed there, not
assumed. The user answered the product questions on 2026-09-25 (§2.4, §2.5). The plan was then
reviewed against the codebase through five lenses (database, security, feasibility, usability,
billing correctness); §13 records what each found and what changed. The user decided the four
questions that review raised (§2.6), so the plan is complete and ready to build. The ticket is Appendix A, word for word.
Rules for switching plans: D-122. Stripe as the record and no new enum values: D-123. No free use,
the one-funding-source limit and prices as constants: D-124.

---

## 1. What this is, in one paragraph

An organization picks a plan (Reconciliation, or Reconciliation + AI), monthly or yearly, and pays
by card on Stripe's hosted page. Stripe charges the card automatically every period. The
organization's admin manages it in a new **Plan & billing** section in Settings: the plan and next
payment, switch, cancel (access continues to the end of the paid period), undo a cancel, and the card
and invoices on Stripe's page. The **Plus** pill opens that section. Stripe is the record of who has
paid; the app keeps a copy, refreshed on every change Stripe reports, with three safety nets for a
lost message. **There is no free use:** an organization without a paid plan (a new sign-up, a plan
that ended, a complimentary period that ran out) reaches only the plan chooser, and every screen,
action, download and shared link refuses it until it pays. Reconciliation allows **one active funding
source**, as the landing page promises. Prices are constants in one file that the landing page, the
app and Stripe all follow. Everything is behind one switch, `BILLING_ENABLED`, off until go-live, so
the phases can ship to production one by one without changing anything for anyone, and switching it
off is the rollback.

---

## 2. Decisions

### 2.1 Changes to Appendix A

| # | Appendix A says | Changed to | Source |
|---|---|---|---|
| C1 | "Allow users to select any plan" | Only an organization **admin** chooses, switches or cancels. Managers see Plan & billing read-only | User, 2026-09-25 (Q3) |
| C2 | "Cancel plan anytime (access … revoke at the end of payment month)" | As written; and if the latest renewal **failed**, ending the plan happens now and cancels the unpaid bill, so a card that works later is never charged for it | User, 2026-09-25 |
| C3 | "Subscribe … monthly or yearly" (silent on switching) | Gives more (better plan, or monthly to yearly) happens **now and is paid now**, applied only if paid; gives less on either axis (lower plan, yearly to monthly, or a mix) waits for the **end of the paid period**, can be undone, and the new plan is billed in full the day it starts | User, 2026-09-25 |
| C4 | (silent on failed payments) | A failed renewal keeps access while Stripe retries, with a banner and a way to update the card; switching is blocked until paid; access ends when Stripe gives up | User, 2026-09-25 |
| C5 | (not in the ticket) | The header Plus pill opens Plan & billing. Base-plan organizations still have no pill (PHASE-11 fix #12); their admins get a **See plans** link beside the existing "…part of the Reconciliation + AI plan." notes | User, 2026-09-25 (Q4) |
| C6 | "Create account → Subscribe → Access" | **No free use at all.** Without a paid plan: the chooser (admins) or a notice naming the admins (managers); no screens, no downloads, no shared links. Records kept, never deleted, back on payment. No free trial | User, 2026-09-25 (Q1, Q5) |
| C7 | (silent on amounts) | $297/month and $497/month. **All amounts are constants** in `src/modules/billing/pricing.ts`; yearly starts at 12 × monthly until someone changes it | User, 2026-09-25 (Q2, O1) |
| C8 | (silent on contracts) | Reconciliation allows **one active funding source**; more need Reconciliation + AI | User, 2026-09-25 |
| C9 | (not in the ticket) | `complimentary_until` is **enforced**; every affected org is listed and confirmed before billing is switched on | User, 2026-09-25 (Q6) |
| C10 | (not in the ticket) | The landing page's pricing follows the real flow: prices from the constants, monthly and yearly, buttons to sign-up for that plan, search data in step; demo buttons removed when sign-up opens | User, 2026-09-25 (O2, O3) |

### 2.2 Taken by this plan (with the reason)

| # | Decision | Why |
|---|---|---|
| P1 | **Stripe is the record; our columns are a copy.** `syncOrgBilling(customerId)` is the only writer of billing columns. It ignores what an event says and re-reads the customer's subscriptions from Stripe. A copy from a Stripe read that started earlier is never written over one that started later (`org_billing.synced_at`, D-125) | Events arrive late, twice, out of order. **Proven**. The in-process lock alone did not order them: the webhook route, the pages and actions, and the nightly reconcile each have their own copy (PR #23 review) |
| P2 | **Every billing action decides from Stripe's live state** and re-derives the change on the server; only plan, interval and the quote timestamp come from a form | Our copy can be one webhook behind; forms can be forged |
| P3 | **The price shown is the price charged**: the quote pins `proration_date`; the charge reuses it; a quote over 15 minutes old or in the future is refused | **Proven** to the cent |
| P4 | **Upgrades**: `proration_behavior: always_invoice` + `payment_behavior: pending_if_incomplete`. Never `create_prorations` | `create_prorations` gave a year free until the year after. **Proven**, fixed |
| P5 | **Downgrades**: a subscription schedule whose next phase has `billing_cycle_anchor: phase_start` and `proration_behavior: none` (on the phase and the update) | Without `phase_start`, a monthly to yearly downgrade was backdated and never billed. **Proven**, fixed |
| P6 | **Upgrade refused while a downgrade is queued** | A declined upgrade would otherwise silently drop the queued downgrade |
| P7 | **Every change refused while an upgrade waits for payment**; the section shows Pay now and the expiry time | **Proven**: on expiry Stripe voids the invoice and nothing is charged later |
| P8 | **No new Postgres enum values** (D-115). Stripe's exact status goes in `stripe_status text`, guarded by a light CHECK (not empty) and validated in code: an unknown status is stored, treated as not paid, and logged `ALERT`, never a failing write | A hard 8-value CHECK would turn a future Stripe status into a webhook that fails forever (DB review) |
| P9 | **One access function, `orgEntitlement`**, used by every AI gate, the paywall, the funding-source limit, shared links and the header pill. Computed in pure code from the org row | Today the plan label alone switches AI on; three sharing files read `subscription_status` directly (security review) |
| P10 | **Complimentary orgs never touch Stripe while complimentary**, and the check is one shared `isComplimentaryNow(org, todayIso())` reused by entitlement and the Checkout refusal | An expired complimentary org must be able to pay (billing review) |
| P11 | **Customer = organization**, found only by `stripe_customer_id`, never by event metadata. No hand-made idempotency key on customer creation. `org_billing.livemode` is stored with the customer, and the whole copy is read only in the configured mode (`billingCopyOn`, D-125); the next Checkout replaces a row from the other mode | Keys built from ids collide across databases (**Proven**); a test-mode id kept after going live would break every Checkout (billing review) |
| P12 | **Locks**: billing actions per org, in-process (every billing action is a server action, and those share one copy of the lock). Syncs take no in-process lock: route handlers get their own copy of the module, so syncs are ordered by `synced_at` under the org row lock instead (P1). The database lock used by staff actions moves out of the `"use server"` file into `src/db/org-lock.ts`; the funding-source create and unarchive, and Checkout's customer replacement, take the same org row lock. Never hold a transaction across a Stripe call | `withLockedOrg` is private to a server-action file and exporting it there would publish it as an endpoint; create has no transaction today (DB, feasibility, security reviews) |
| P13 | **Three nets for a lost webhook**: the Checkout return route re-syncs; any page re-syncs an overdue copy (at most every 5 minutes per org), after the page is sent (`after()` in the `/r` layout), so a slow Stripe never holds up a page; each Stripe attempt gives up after 10 s (the SDK default was 80 s), about 30 s with the two retries; nightly `billing:reconcile` from the host crontab via `docker compose exec` | **Proven**: the first sandbox payment's webhooks never arrived |
| P14 | **Stripe's hosted pages** for card entry, card updates and invoices; the portal allows card, invoices and billing details only | The switching rules live in the app; card data never touches our servers |
| P15 | **Billing changes in `/a` History** reuse the `plan_changed` action with a new `via_stripe` flag, shown as "Stripe" | No new enum value; null actor already renders |
| P16 | **Staff can't hand-set plan or status while an org has a live subscription** (checked on the server in `changePlanAction`, not only a disabled dialog); once it lapses, staff can again | One writer per field, without locking staff out of lapsed orgs forever |
| P17 | **The webhook checks `event.livemode`** against the key's mode and refuses a mismatch | A test event must never change a live org |
| P18 | **All copy in `UI`** (§10); "Plus" only on pills and tours, plan names in billing text; no dashes | Words rules, D-113 |
| P19 | **Settings sections addressable by URL** (`?section=plan`), known ids only; the tour's "starts on Organization" line is updated | Deep links from the pill and banners |
| P20 | **Prices are constants in cents; Stripe is made to match.** `billing:setup` creates a new Stripe Price when a constant changes, with `metadata.plan`, and moves the lookup key (`transfer_lookup_key`) | One place to change a price |
| P21 | **Existing subscribers and price changes: both are possible, chosen before go-live (O4).** `billing:move-subscribers` moves them at their next renewal via a schedule phase tagged `metadata.reason=price_move` (shown as "New price from {date}", kept when a queued change is cancelled, applied to queued downgrades too); subscriptions with a pending upgrade or a pending cancel are skipped and listed; always a dry run first. Every schedule rewrite repeats the current phase exactly, trial included (a plan bought during free access is charged at `trial_end`, never earlier), and a rewritten downgrade keeps `billing_cycle_anchor: phase_start`; one org's failure is listed as `error: …` with an ALERT and the run carries on, then exits 1 (PR #23 review; to confirm in the sandbox) | Designed with the schedule and pending-update interactions the billing review found |
| P22 | **No free use is enforced at every entry point, guarded by default** (§4.7): pages call `pageSession()`, actions use `actionSession()`/`requireAdmin()` which refuse unpaid orgs, route handlers call `routeSession()`, shared links check in `loadPublicShare`. A short allow-list uses `*AnyPlan` variants. A static test enumerates every page, action and route | A layout alone still sends page data to the browser (Next 16 docs, `authentication.md:1352`); the planned single guard missed every page and 13 of 19 routes (security, feasibility reviews) |
| P23 | **Funding-source limit**: `activeFundingSourceLimit(entitlement)` (1 on Reconciliation), checked in create and unarchive under the org lock; unarchiving an already active source doesn't count itself | Only two paths activate a source (verified) |
| P24 | **A downgrade, or a Checkout, to Reconciliation is refused while more than one source is active**; while a downgrade to Reconciliation is queued, adding or unarchiving is refused. Checked against Stripe's live schedule, not our copy | Closes the lapsed-org loophole (§2.6 D2) and the queued-downgrade race |
| P25 | **`BILLING_ENABLED` switch**, like `SIGNUP_ENABLED`, default false. Off: everyone is paid on their current plan (today's behaviour), no limit, billing actions refuse, the webhook answers 503 (Stripe retries), Settings has no Plan & billing section and the Plus pill is not a link, the app starts without Stripe keys. On: the startup check requires the keys and an https `APP_URL` | Phases 1 to 7 reach production before go-live; the old rollback ("remove the key") would have stopped the app booting (all reviews) |
| P26 | **Pinned Stripe SDK version and API version**; the webhook endpoint set to the same API version; the sandbox suite re-run on any SDK update | The proofs depend on SDK 22 / API 2026-08-26 (billing review) |
| P27 | **The sync writes `plan` and status only from a live subscription**; a complimentary grant carries its own `complimentary_plan`. Staff changing the plan, or ending the grant, clears `complimentary_plan`, so a pin left by an unfinished Checkout never overrides what staff chose (PR #23 review) | Otherwise a dead old subscription would overwrite a staff grant of Reconciliation + AI (billing review) |
| P28 | **Test and dev orgs are complimentary by default** (`createTestOrg`, `seed.ts`, `dev-fixture.ts`, and the ~12 test files that insert orgs directly); billing tests opt out | Otherwise 25 to 35 existing integration files hit the paywall (feasibility review) |

### 2.3 Assumptions

- USD only. Card payments, including Apple and Google Pay; Checkout passes `payment_method_types: ['card']` so a slow bank debit can't start. Adaptive Pricing and automatic tax off, checked in §11.
- No email from the app; Stripe sends receipts and failed-payment emails. The customer's email follows the org's current admin (updated on each billing action).
- One app process (P12). The app has no organization deletion; if it is ever added, it must cancel the subscription first.

### 2.4 Answers from the user (2026-09-25)

| # | Question | Answer |
|---|---|---|
| Q1 | What can an org with no paid plan do? | "there is no free way pay to use"; confirmed later: "just ask them to pay and then they can continue" |
| Q2 | Prices | $297 and $497 a month, "keep it as constants so we can change the values later" |
| Q3 | Only admins manage billing? | Yes |
| Q4 | Upgrade path for base-plan orgs | See plans link beside the existing Plus notes |
| Q5 | Free trial? | No |
| Q6 | Enforce `complimentary_until`? | Yes, after listing affected orgs |
| (new) | One contract on Reconciliation: enforce or change the page? | Enforce it in the app |

### 2.5 Follow-up answers and what is still open

| # | Item | Answer |
|---|---|---|
| O1 | Yearly amounts | Constants; 12 × monthly until changed |
| O2 | Unverified features on the pricing card | **Done**: replaced with the app's real AI features |
| O3 | Demo buttons | Revised by D4: a **Book a demo** button stays (on each pricing card and in the closing section); the "Early access" button is removed |
| O4 | Price changes for existing subscribers | Both built (P21); chosen before go-live |
| O5 | The landing AI section's claims (variance notes, board briefings, sample memo) | Open: confirm or reword in Phase 7 |

### 2.6 Needs a decision (from the review)

| # | Decision | Recommendation |
|---|---|---|
| D1 | **Which Stripe account.** The account in use is named "Authentic Business"; going live on it means its bank, its name on receipts, and account-wide settings (retry rules, emails, payment methods) shared with anything else on it | **Decided 2026-09-25: "use the same env"**, the existing account, for development (its sandbox) and live. Consequence accepted: §11 step 0 confirms the payout bank, receipt name and statement descriptor are right for Team Pursuit before switching billing on, and account-wide settings are changed only after checking nothing else on the account depends on them |
| D2 | **A lapsed Reconciliation + AI org with three funding sources re-subscribes to Reconciliation** | **Decided 2026-09-25:** Reconciliation is refused at Checkout while more than one source is active, and the admin can archive sources from the plan page (archiving is on the paywall's allow-list); they can also choose Reconciliation + AI |
| D3 | **Staff suspend an org that is paying**: Stripe keeps charging an org that can't sign in | **Decided 2026-09-25:** suspending pauses collection (Stripe `pause_collection`, bills voided) and reinstating resumes it; the interaction with a queued change is settled by a sandbox test (S-30) |
| D4 | **Usability changes that go beyond the ticket** | **Decided 2026-09-25:** warn admins 14 days before complimentary access ends (yes); the funding-source limit is a disabled button with the reason under it, worded "To add more, try Plus." (the user's wording, a deliberate exception to P18); Plan & billing is a Settings section ("in settings"; placed near the end, Organization stays the default); the landing plan buttons keep **Get started** and each pricing card gets a **Book a demo** button, the "Early access" button goes |
| D5 | **A complimentary org wants to buy a plan before its free access ends** | **Decided 2026-09-25 (while testing):** allowed. With an end date 2 or more days away (Stripe's minimum for `trial_end`, plus an hour), Checkout saves the card and defers the first charge to local midnight after the last free day; otherwise it charges today and the sync ends the free access once paid (subscription metadata `endComplimentary`, only for a grant older than the subscription, so a later staff grant is never undone). The free plan is pinned in `complimentary_plan` before Checkout, so buying Reconciliation during free Reconciliation + AI keeps the AI features until the free access ends. Switching plan and End plan now stay refused while complimentary; cancel, keep and Card and invoices are allowed for the bought plan. **Replaced by D-128 (2026-09-28):** buying always pays today and ends the free access once paid, whatever was left of it; no deferred first charge, no pinned free plan, and Keep my plan is refused while complimentary |

Adopted without asking (reviewers' recommendations, reversible): an unpaid admin can still change
their password and remove a departed user; a card dispute changes no access but logs `ALERT` and
flags the org in `/a`.

---

## 3. Data model (one migration, `0041`)

**Revised 2026-09-26 (PR #23 review, D-125):** the Stripe copy moved off `organizations` into its
own table, `org_billing`. `stripe_subscription_id` (never read) is gone, `billing_flag` became the
date `disputed_at`, and `billing_synced_at` became `synced_at`.

`org_billing`, one row per organization, created with its first Stripe customer (1:1, like
`contract_settings`). Every read goes through `billingCopyOn()` (`src/db/billing-copy.ts`), which
also matches `livemode` to the configured key, so a row from the other Stripe mode reads as no
copy at all (P11):

| Column | Type | Notes |
|---|---|---|
| `org_id` | uuid PK, FK `organizations` ON DELETE CASCADE | |
| `stripe_customer_id` | text NOT NULL UNIQUE | The UNIQUE index serves the sync's lookup |
| `livemode` | boolean NOT NULL | The mode the customer belongs to (P11). Checkout replaces a row from the other mode, and its copy with it |
| `stripe_status` | text, CHECK `stripe_status IS NULL OR length(stripe_status) > 0` | Exact Stripe status, validated in code (P8) |
| `billing_interval` | text, CHECK (`month`, `year`) | |
| `current_period_end` | timestamptz | Renewal date, or the cancel date when cancelling |
| `cancel_at_period_end` | boolean NOT NULL default false | Includes a dashboard `cancel_at` within this period |
| `pending_plan` | org_plan | Queued downgrade (existing values only) |
| `pending_interval` | text, CHECK | |
| `pending_at` | timestamptz | When it starts |
| `pending_reason` | text, CHECK (`downgrade`, `price_move`) | P21 |
| `upgrade_pay_url` | text | Upgrade awaiting payment: Stripe's hosted invoice page |
| `upgrade_expires_at` | timestamptz | |
| `collection_paused` | boolean NOT NULL default false | D3 |
| `disputed_at` | timestamptz | When the latest card dispute was opened; shown in `/a`, never cleared, never changes access |
| `synced_at` | timestamptz | When the Stripe read behind this copy started; throttles the stale re-sync |

`organizations` gains only `complimentary_plan` (org_plan, null): the plan a complimentary grant
gives (P27); null means today's `plan`. `org_account_events`: `via_stripe boolean NOT NULL
default false`.

The sync writes the existing `plan` and `subscription_status` only from a live subscription
(trialing→trial, active→active, past_due and unpaid→past_due, canceled and incomplete_expired→
cancelled), so `/a` counts keep working. Staff edits of those two are refused on the server while a
subscription is live (P16).

Migration test `src/db/migration-0041.test.ts`: creates `org_billing`, then only nullable or
defaulted adds to existing tables (counted, so the check can't pass by matching nothing), no
`ALTER TYPE`, no enum literal in any CHECK, no `UPDATE` statement. Rollback: drop `org_billing` and
the two columns; `via_stripe` on past History rows is lost, which is cosmetic (before and after
snapshots stay).

---

## 4. How it works

### 4.1 Server surface

Every billing action is **admin only**, checked inside the action, and decides from Stripe (P2).

| Entry | What it does | Refuses with |
|---|---|---|
| `startCheckoutAction(plan, interval)` | Refuses if complimentary now, a live or processing subscription exists, or (Reconciliation) more than one active source; expires other open Checkouts; returns Stripe's URL | `billingNotAdmin`, `billingComplimentaryRefused`, `billingAlreadySubscribed`, `billingPaymentProcessing`, `billingUnknownPlan`, `billingDowngradeTooManySources` |
| `quoteChangeAction(plan, interval)` | Changes nothing; Stripe's figures for the dialog | `billingNoPlan`, `billingPaymentFailedRefused`, `billingCancelPending`, `billingPaymentPending`, `billingChangePending`, `billingSamePlan`, `billingDowngradeTooManySources` |
| `applyChangeAction(plan, interval, prorationDate)` | Upgrade now (P4) or queue a downgrade (P5) | as quote, plus `billingQuoteExpired` |
| `cancelPendingChangeAction()` | Drops a queued downgrade (keeps a price move, P21) | `billingNoPlan` |
| `cancelPlanAction()` | Cancel at period end; drops a queued downgrade | as quote |
| `endPlanNowAction()` | Payment failed: cancel now, void open invoices (C2) | `billingNoPlan` |
| `resumePlanAction()` | Undo a pending cancel, including a dashboard `cancel_at` | `billingNoPlan` |
| `billingPortalAction()` | Stripe portal | `billingPortalNotSetUp` |
| `GET /r/billing/return` | Ignores query parameters; re-syncs this org's own customer (throttled); redirects to a fixed path | not signed in → `/login` |
| `POST /api/stripe/webhook` | Body read with `readCappedText` (1 MB), never `readJsonBody` (its same-origin check would refuse Stripe); signature and mode check; org found by `stripe_customer_id` only, unknown customers skipped without calling Stripe; `syncOrgBilling`. 400 not from Stripe or wrong mode, 503 while billing is off, 500 on our failure, 200 otherwise. Not rate limited | |

Actions return `ActionResult` and are rate limited per user. Code in `src/modules/billing/`
(`pricing.ts`, `rules.ts`, `entitlement.ts`, `stripe.ts`, `sync.ts`, `actions.ts`, `scripts/`),
framework-free where possible, as in the reference build.

### 4.2 Access

`orgEntitlement(org, today)` in `src/modules/billing/entitlement.ts`, pure, returns `{ paid, plan, reason }`:
1. `BILLING_ENABLED` off → paid on `plan` (today's behaviour);
2. suspended → handled earlier by `resolveSession` (unchanged);
3. `isComplimentaryNow(org, today)` → paid on `complimentary_plan ?? plan` (reuses `complimentaryState`, moved from `admin/directory.ts` to `src/domain/`, with `todayIso()`, America/Detroit; "until today" still counts);
4. `stripe_status` in (`active`, `trialing`, `past_due`) → paid on `plan`;
5. otherwise not paid, with the reason (`new`, `ended`, `complimentary_ended`) the paywall shows.

`resolveSession` already joins `organizations`: it selects the billing columns and computes the
entitlement once per request (React `cache`). Callers of `aiPlanAllowed`, the AI loaders (3
expense pages, packet, monthly summary, 4 API routes, `app/r/settings/page.tsx:85`), the header
pill and `loadPublicShare` all use it.

### 4.3 Settings → Plan & billing

A section `plan`, placed near the end of the sidebar (D4), Organization stays the default;
`?section=` opens any known section. Same pattern as the others: sidebar item with icon, `Card`,
`CARD_PADDING`, `SectionTitle gradient`, a skeleton row in `loading.tsx`. While `BILLING_ENABLED`
is off it says "Plan and billing will be available here soon." and nothing else.

| State | Shows | Admin actions |
|---|---|---|
| Complimentary | `billingComplimentary` or `billingComplimentaryUntil`, `billingQuestions` | none |
| Complimentary ending within 14 days | + banner `billingCompEnding` | **See plans** |
| Payment going through (just back from Checkout, or processing) | `billingProcessing` | none |
| Left Checkout without paying | `billingCheckoutAbandoned` above the chooser | the chooser |
| Active | Plan name (Plus pill on Reconciliation + AI), `billingBilledMonthly/Yearly`, `billingRenews` | **Switch plan**, **Card and invoices** (+ `billingPortalHelp`), **Cancel plan** (quiet) |
| Downgrade queued | + `billingDowngradeQueued` | + **Cancel this change** |
| New price queued (P21) | + `billingPriceMoveQueued` | none |
| Cancelling | `billingCancelling` | **Keep my plan**, **Card and invoices** |
| Upgrade awaiting payment | `billingUpgradeWaiting` | **Pay now** |
| Payment failed | Danger panel `billingPaymentFailed` (wins over every other notice; hides Pay now and Cancel this change) | **Card and invoices**, **End plan now** |
| Manager, any state | the same information, `billingManagerNote`, no buttons | none |

**Switch plan** shows the same two plan cards as the chooser, the current one marked "Your plan";
picking a card opens the dialog. A Reconciliation card that would break the one-source limit is
disabled with `billingDowngradeTooManySources` and a **Go to Funding sources** link.

**Switch dialog** (`Dialog`, tone neutral, sm), title `billingSwitchTitle`, label and value pairs
(not a table, so it fits 375px): Current plan, New plan, Changes (Right away / {date}), Charged
today, After that; one sentence (`billingUpgradeExplain` or `billingDowngradeExplain`); confirm
**Pay {amount} and switch** or **Switch on {date}**; pending label "Switching…" with the dialog
locked (`dismissDisabled`).

**Cancel dialog** (tone danger): `billingCancelTitle`, `billingCancelBody`; confirm **Cancel plan**,
dismiss **Keep my plan** (never a bare "Cancel"). **End plan now** has its own danger dialog,
`billingEndNowTitle` / `billingEndNowBody`, confirm **End plan now**, dismiss **Keep my plan**.

Every Stripe step says it is working: "Opening the payment page…", "Opening Stripe…",
"Confirming your payment…".

### 4.4 The Plus pill

`PlusBadge` gains an optional `href`; only the header passes it (`/r/settings?section=plan`), and
only while billing is on (until then Settings has no Plan & billing section, and an old
`?section=plan` link opens Organization; PR #23 review), with a
44px tap area, hover and focus ring, and `aria-label` "Plus plan, open Plan & billing". The pills in
upload fields, the suggestion panel and the summary title stay decorative. The header pill shows only
when the entitlement is paid on Reconciliation + AI. **See plans** for base-plan admins is a
separate link beside the note, never inside `UI.summaryPlanNote` (that string is also a server
refusal and a 403 body).

### 4.5 Banners

One billing banner at most, under the header, hidden while Plan & billing is open: payment failed
(admins: **Card and invoices**; managers: `billingPaymentFailedManager`, naming the admins), upgrade
awaiting payment, complimentary ending within 14 days. Nothing for healthy or complimentary orgs.

### 4.6 Staff dashboard `/a`

For an org with a live subscription: plan and status edits refused on the server and disabled with
`staffStripeManaged` and a link to the Stripe customer; the org page shows interval, renewal, queued
change, failed payment, the date of a card dispute (`disputed_at`). History shows "Stripe" for `via_stripe` rows. Granting
complimentary to a paying org asks staff to cancel the subscription now or at period end in the same
dialog. Suspending a paying org pauses collection; reinstating resumes it (D3).

### 4.7 No free use at every entry point (C6, P22)

Guarded by default, so a new page, action or route is protected unless someone opts it out:
- **Pages**: every `app/r/**/page.tsx` and both onboarding pages call `pageSession()`, which returns
  the session or renders/redirects to the plan page (`/r/plan`, its own route so it never loops).
  The layout is not the gate.
- **Actions**: `actionSession()` and `requireAdmin()` return `{ denied: fail(billingPlanRequired) }`
  for an unpaid org (never throw, so no 500s). The private `requireSessionOrExpired` in
  `auth/actions.ts` is replaced by `actionSession`.
- **Routes**: the 13 route handlers that call `getSession()` directly switch to `routeSession()`,
  which answers 401 or 403. The three that go through `readSignedInJson` are covered by the actions
  they call.
- **Shared links**: `loadPublicShare` checks `orgEntitlement`; the two other readers of
  `subscription_status` in sharing use it too.
- **Allow-list** (`actionSessionAnyPlan()`, `requireAdminAnyPlan()`, `routeSessionAnyPlan()`, only
  callable from listed entries): sign in, sign up, sign out, change password, the billing actions,
  archive funding source (D2, admin only while unpaid), list and revoke users, `/api/me/avatar`
  GET (seeing the photo; changing it is paid), `/r/billing/return`, the webhook. Each is listed by
  exact `file#name` in `guard-coverage.test.ts` (no wildcard or folder entries), and each must still
  check who is asking unless it rightly can't (sign in, sign up, sign out, the webhook, public
  links). Staff `/a` is separate (`requireStaff`). Not allowed: onboarding, month and source
  selectors, welcome, tours, downloads, files, `/api/users/avatar`.
- **Order**: sign-up and sign-in send an unpaid org to `/r/plan` before onboarding; `/r/plan` shows
  the chooser (plan preselected from the landing link, with a "Choose a different plan" link) and,
  after payment, onboarding runs as today.
- **The page** shows the header with the profile menu (Sign out), "Choose a plan for {org}", the
  headline for its reason (`billingChooseNew`, `billingEnded`, `billingCompEnded`), one
  Monthly/Yearly toggle, stacked cards at 375px; managers see `billingUnpaidManager` naming the
  admins; when D2 applies, the active funding sources with Archive buttons.

### 4.8 One funding source on Reconciliation (C8, P23, P24)

**Add funding source** and **Unarchive** are disabled with the reason under them
(`fundingSourceLimitReached` + See plans for admins, `fundingSourceLimitManager` for managers,
`fundingSourceLimitQueued` while a downgrade is queued); the actions refuse the same on the server,
under the org lock. An org that somehow has two sources on Reconciliation keeps them and can't add a
third; `/a` shows a warning.

### 4.9 Prices and the landing page (C7, C10, P20, P21)

```ts
// src/modules/billing/pricing.ts
export const PRICES_CENTS = {
  reconciliation:    { month: 29_700, year: 356_400 }, // yearly: 12 × monthly until changed (O1)
  reconciliation_ai: { month: 49_700, year: 596_400 },
} as const;
```

Read by the landing cards and FAQ (`landing-page.tsx` lines 146, 888, 1068, 1121), the JSON-LD
(`app/page.tsx` 74, 83; both intervals), the in-app chooser and dialog (which show Stripe's figures,
proven equal by S-26) and `billing:setup`. The landing page is a client component, so `app/page.tsx`
passes the prices and `signupEnabled()` as props. Monthly/Yearly toggle, default Monthly; yearly
shows "{price}/year" and a saving only when there is one. Each pricing card has **Get started**
and **Book a demo** (D4). Get started goes to `/signup?plan=…&interval=…` when sign-up is open
(values checked against the enum, no return-to parameter) and to the demo request while it is
closed; Book a demo always opens the demo request. The closing section keeps Book a demo and drops
"Early access" (O3). O5 is settled here.

---

## 5. Acceptance criteria

Each names the tests that prove it (§8). DONE only when every named test exists, passes, and (for a
guard) has been mutation-checked.

**A. Choosing and subscribing**
- **AC-A1** An unpaid admin sees both plans, monthly and yearly, prices from Stripe equal to `pricing.ts`, and each plan's features. (B-1, U-12, S-26)
- **AC-A2** Subscribe opens Checkout for exactly that plan and interval, for the org's own customer, card only. (S-1)
- **AC-A3** After paying, Plan & billing shows the plan active without waiting for the webhook; while it is still going through it says so. (S-16, B-2)
- **AC-A4** The org gets every feature of its plan and none of the other's. (U-3, I-4, S-2)
- **AC-A5** One open Checkout per org; none while a subscription is live. (S-1)
- **AC-A6** None while a payment is processing. (S-19)
- **AC-A7** A manager can't start Checkout, by button or by calling the action. (I-2)
- **AC-A8** Reconciliation Checkout is refused with more than one active source, and the admin can archive sources from the plan page. (I-15, B-19)

**B. Upgrades**
- **AC-B1** Every switch shows the dialog first; opening it changes nothing. (S-2, B-3)
- **AC-B2** The charge equals the dialog to the cent; the next bill is the plain new price. (S-2, S-3)
- **AC-B3** Monthly to yearly keeps the original billing date; the dialog shows it. (S-3)
- **AC-B4** Declined or 3-D Secure: plan unchanged, no AI, sent to Stripe's page. (S-4, S-17)
- **AC-B5** Paid there → applies; not paid → after 23 hours nothing owed, nothing open, never charged later. (S-4, S-5)
- **AC-B6** While it waits, every other change is refused; Pay now and the time and date are shown. (S-4, B-6)
- **AC-B7** A double-click charges once. (S-15)
- **AC-B8** A forged, future or stale quote is refused and nothing is charged. (S-14)

**C. Downgrades**
- **AC-C1** Nothing charged today; features kept to the period end. (S-6, S-8, S-20)
- **AC-C2** On the switch date the new plan is billed in full; no unpaid time. (S-6, S-8, S-20, paid-through check)
- **AC-C3** A queued downgrade can be cancelled. (S-7)
- **AC-C4** Upgrade refused while one is queued; another downgrade replaces it. (S-9)
- **AC-C5** After a downgrade, upgrading and downgrading again work. (S-21)
- **AC-C6** A downgrade to Reconciliation with more than one active source is refused before anything is created in Stripe. (S-27)

**D. Cancelling**
- **AC-D1** Access to the end of the paid period, then none, nothing more charged. (S-10)
- **AC-D2** Keep my plan undoes it, including a dashboard `cancel_at`. (S-10, S-22)
- **AC-D3** Cancelling drops a queued downgrade. (S-11)
- **AC-D4** The cancel dialog states the end date and what happens after; its buttons are Cancel plan and Keep my plan. (B-4)

**E. Failed payments**
- **AC-E1** Stripe charges automatically every period. (S-12)
- **AC-E2** A failed renewal keeps access, shows the banner and panel, blocks switching. (S-13, B-5)
- **AC-E3** Updating the card and paying restores active. (S-13)
- **AC-E4** End plan now ends it, voids the bill, nothing charged later; it has its own dialog. (S-18, B-5)
- **AC-E5** When Stripe gives up, access ends (sandbox with the dashboard rule set; the live setting recorded). (S-23)

**F. Access**
- **AC-F1** `orgEntitlement` is the only place billing state becomes a yes or no. (U-4, U-20)
- **AC-F2** A cancelled Plus org loses AI on every screen and route. (I-4, I-5)
- **AC-F3** An unpaid org can do nothing but choose a plan (group N).
- **AC-F4** Complimentary until today still has access; the day after it is unpaid (America/Detroit). (U-4, I-10)
- **AC-F5** With `BILLING_ENABLED` off, every org behaves exactly as before this phase, the app starts without Stripe keys, and the webhook answers 503. (U-21, I-16)

**G. Plan & billing section**
- **AC-G1** The section exists, deep-links by `?section=plan`, unknown values open Organization. (U-13, B-7)
- **AC-G2** Each §4.3 state shows exactly its text and actions. (U-14, B-1 to B-6)
- **AC-G3** Managers see information and no buttons; every action refuses them. (I-2, B-8)
- **AC-G4** Design language: primitives only, no new colours, no spinner, labels swap, 44px targets, 375px without sideways scroll, dialogs fit. (B-9)
- **AC-G5** Every string in `UI`, passing the dash and spelling tests. (U-15)

**H. Plus pill**
- **AC-H1** The header pill opens Plan & billing by mouse and keyboard, with its label and a 44px target. (B-10)
- **AC-H2** Other pills stay decorative. (U-16)
- **AC-H3** Base-plan admins see See plans beside the Plus notes; managers don't. (B-11)

**I. Staff dashboard**
- **AC-I1** Plan and status can't be set for an org with a live subscription, on the server; complimentary and suspend still work. (I-7)
- **AC-I2** Every sync change appears once in History as Stripe; no change writes nothing. (I-6)
- **AC-I3** Suspending a paying org pauses collection; reinstating resumes it. (S-30)

**J. Nothing changes for existing organizations**
- **AC-J1** Complimentary orgs see no difference except the section, and create a Stripe customer only when their admin chooses to buy a plan (D5); before billing is switched on, every org with an end date, every unpaid non-complimentary org, and every Reconciliation org with more than one source is listed and resolved. (I-1, B-12, §11 record)
- **AC-J2** The migration changes no row. (U-1)
- **AC-J3** The existing suite passes unchanged apart from test orgs becoming complimentary by default. (full suite)

**K. Safety nets**
- **AC-K1** The webhook refuses missing, forged, wrong-secret, tampered, replayed or wrong-mode events and never syncs on one. (U-6)
- **AC-K2** Duplicate, late and out-of-order events end in the same row; syncs for one org never interleave. (U-7, I-3, S-24)
- **AC-K3** A lost webhook is repaired by the return route, the stale re-sync or the nightly reconcile. (S-16, I-8)
- **AC-K4** A customer deleted in Stripe leaves the org unpaid. (S-25)
- **AC-K5** A Stripe error shows `billingStripeError`; a failed refresh after money moved never turns success into an error. (U-8)
- **AC-K6** Two live subscriptions, an unknown Stripe status, or a dispute log `ALERT`; nothing refunds automatically. (U-9)

**L. Security**
- **AC-L1** No action takes a customer, subscription, invoice or org id from the client. (U-10)
- **AC-L2** Redirects go only to Stripe-returned URLs or fixed paths on `siteOrigin()`. (U-11)
- **AC-L3** With billing on, the app refuses to start without valid Stripe keys or with a live key on http. (U-5)
- **AC-L4** `/security-review` and the red-team pass have no open high findings.

**N. No free use, and sign-up**
- **AC-N1** An unpaid admin on any `/r` URL gets the plan page; a manager gets the notice naming the admins; page data is never sent. (U-17, I-9, B-13)
- **AC-N2** Every page, action and route is guarded or on the allow-list, proven by a static test that fails when any guard is removed or an `*AnyPlan` helper is used outside the list. (U-18, I-9)
- **AC-N3** Downloads and shared links refuse an unpaid org. (I-9, B-14)
- **AC-N4** Nothing is deleted or changed when an org becomes unpaid; paying restores everything. (I-11, B-15)
- **AC-N5** Create account → Subscribe → Access, with the landing plan preselected; skipping payment reaches nothing, including onboarding; no redirect loop. (I-12, B-16)
- **AC-N6** Expired complimentary access makes the org unpaid, with a 14-day warning before. (I-10, B-20)

**O. One funding source on Reconciliation**
- **AC-O1** Create and unarchive are disabled with the reason and refused on the server; concurrent attempts allow one. (I-13, B-17)
- **AC-O2** Reconciliation + AI allows any number. (I-13)
- **AC-O3** Adding is refused while a downgrade to Reconciliation is queued. (I-14)
- **AC-O4** No source is archived, hidden or deleted by a plan change. (I-14)

**P. Prices and the landing page**
- **AC-P1** Every shown or charged price comes from `pricing.ts`. (U-19, S-26)
- **AC-P2** Stripe's active prices equal the constants, with `metadata.plan`, interval, USD, one per lookup key. (S-26)
- **AC-P3** Existing subscribers are untouched unless `billing:move-subscribers` runs; its dry run lists who changes and who is skipped; a real run takes effect at the next renewal only. (S-28, S-29)
- **AC-P4** The landing page offers Monthly and Yearly; each card has Get started (sign-up for that plan and interval when sign-up is open, the demo request while closed) and Book a demo; "Early access" is gone. (B-18)
- **AC-P5** One name per plan; every feature listed exists in the app. (B-18, review)

**M. Going live**
- **AC-M1** §11 done and recorded, including one real payment and refund.

---

## 6. Edge cases → handling → test

| Case | Handling | Test |
|---|---|---|
| Double-click Subscribe | Per-org lock; older session expired | S-1 |
| Tab 1 pays while tab 2 opens Checkout | `expire` fails on the completed session and nothing new is created | S-1 |
| Admin demoted mid-flow | Every action re-checks the role | I-2 |
| Paying org suspended | Collection paused (D3) | S-30 |
| Complimentary granted to a paying org | Staff choose cancel now or at period end | I-7 |
| Complimentary grant while an old subscription is dead | Plan comes from `complimentary_plan`, never the dead subscription | U-7 |
| Complimentary expires with a live subscription | The subscription decides (P9 order) | U-4 |
| Price archived or missing metadata | Checkout and switching refuse; S-26 catches it before release | U-12, S-26 |
| Unknown Stripe status | Stored, treated as unpaid, `ALERT` | U-7 |
| Webhook for another business's customer | Org not found by customer id: 200, no Stripe call | U-6 |
| Stripe down | Webhook 500 (retry), action `billingStripeError`, page shows last copy | U-6, U-8, I-8 |
| Upgrade after a downgrade happened (schedule still attached) | No future phase: released, upgrade proceeds | S-21 |
| Dashboard `cancel_at` beyond this period | Not shown as cancelling | U-7 |
| Race: downgrade queued while a second source is added | Create and unarchive read the queued downgrade from the copy under the org row lock; `applyChange` re-syncs the copy right after scheduling it. A source added in the second between the two isn't refused (accepted: the two don't share a lock) | I-14 |
| New sign-up not onboarded | `/r/plan` before onboarding, no loop | I-12 |
| Old bookmark while unpaid | `pageSession` redirects to `/r/plan`; the same URL works after payment | B-15 |
| Plan on hold: Stripe stopped retrying (`unpaid`) or paused it | Unpaid, so the paywall sends everyone to `/r/plan`, where Subscribe would only refuse ("already has a plan"). `/r/plan` shows the Plan & billing panel instead: admins pay the bill or change the card in Card and invoices (Stripe's portal; its return lands back here) or End plan now (`paused` too), then choose a plan; managers see who the admins are (D-126) | `no-free-use.integration.test.ts`, `plan-view.test.ts`, `actions.integration.test.ts` |
| Complimentary ends at midnight during work | Next save refused `billingPlanRequired`; warned 14 days before | I-10, B-20 |
| Dispute on a charge | No access change; `ALERT`; flag in `/a` | U-9 |
| Admin who is the Stripe email leaves | Customer email updated on the next billing action and on removal | I-17 |
| Test-mode customer id after going live | The whole copy is read only in the key's mode (`billingCopyOn`, D-125): absent, grants nothing, and the next Checkout replaces the row | U-7, `access-mode.integration.test.ts` |
| Customer deleted in the Stripe dashboard | The sync sees its cancelled subscriptions (org unpaid, S-25); the next Checkout asks Stripe, finds it deleted and starts a new customer with an empty copy | S-25, `actions.integration.test.ts` |
| Customer this key's account has never seen (key moved to another account) | ALERT and throw: the sync keeps the last copy (webhook 500, reconcile fails), Checkout refuses; a paying org is never marked unpaid and its id never replaced | `sync.integration.test.ts`, `actions.integration.test.ts` |

---

## 7. Build phases

Each phase ends with typecheck, lint, the **full** suite and `npm run test:stripe` green (never
skipped), plus its checks; plan → review → implement → review → browser test → commit; a
**Results** block like PHASE-12. `BILLING_ENABLED` stays false in production until Phase 8.

### Phase 0: prerequisites
- Next.js 16.3.1 → 16.3.6 (two critical advisories). Full suite, build, browser smoke.
- D1 answered; a Stripe Sandbox for development.

**Passes when:** `npm audit` shows no critical advisory; the app runs unchanged.

**Results (2026-09-25).**
- **Built:** `next` and `eslint-config-next` 16.3.1 → 16.3.6, still pinned exactly. The lockfile
  otherwise moved only Next's own dependencies (`@next/*`, `sharp` 0.35.4 and its binaries, three
  small packages now listed explicitly, `fastq` patch) and dropped 26 orphaned `@esbuild/*` entries
  under `vitest` that had no parent before or after.
- **Audit:** critical 0 (was 2). Left for separate work, all present before: 8 moderate and 1 high in
  dev tooling (drizzle-kit/esbuild, vitest, js-yaml) and, at runtime, `exceljs` → `uuid` (the only
  offered fix downgrades exceljs a major version).
- **Tests:** typecheck and lint clean; production build passes; full suite **2171 passed of 2171**
  (170 files, database running, none skipped).
- **Found and fixed on the way:** `src/modules/sharing/public-isolation.test.ts` resolved relative
  imports with `path.relative`, which returns backslashes on Windows, while its forbidden-import
  patterns use `/`. On Windows, a relative import of the session module into a public shared-link
  file passed the "imports no a session" check. **Mutation-proved:** with such an import added, the
  old test passed that check and the fixed one fails it; restored.
- **Browser smoke:** dev server; `/`, `/login`, `/robots.txt`, `/sitemap.xml` 200, `/r` 307 to sign
  in; the landing pricing card shows the new features; no server errors.
- **Not verified:** a signed-in walk through the app in a real browser (HTTP only); Linux `npm ci`
  with the new lockfile (the deploy does it).

### Phase 1: foundations
- `stripe` (pinned), `BILLING_ENABLED`, startup check (only when on), migration `0041` + test +
  rehearsed rollback, `pricing.ts`, `rules.ts`, `entitlement.ts`, `complimentaryState` moved to
  `src/domain/`, `src/db/org-lock.ts`, test and dev orgs complimentary by default (P28), strings,
  `vitest.stripe.config.mts` and `test:stripe`.

**Passes when:** U-1 to U-5, U-13, U-15, U-21 pass; the full suite passes (AC-J3).

**Results (2026-09-25).**
- **Built:** `stripe` 22.6.2 pinned exactly; `src/modules/billing/config.ts` (`billingEnabled()`,
  `billingConfigProblems(env)`, `STRIPE_API_VERSION` 2026-08-26.dahlia; no `server-only` because
  `instrumentation.ts` imports it); `instrumentation.ts` runs the billing check first, in every
  environment, only when `BILLING_ENABLED` is exactly `"true"`, and reports every problem in one
  error that names variables, never values; `pricing.ts` (`PRICES_CENTS`, `lookupKey`,
  `priceCents`); `rules.ts` (intervals, plan rank, AI features per plan keyed by
  `ai_usage_feature`, funding-source limit per plan, known and paid Stripe statuses, `isLive`,
  `pickCurrent`, `classifyChange`, `changeBlockedReason`); `entitlement.ts` (`orgEntitlement`,
  `activeFundingSourceLimit`); `complimentaryState` moved to `src/domain/complimentary.ts` with
  `isComplimentaryNow` (its tests moved unchanged); `src/db/org-lock.ts` `lockOrg(tx, orgId,
  fields)`, used by the staff actions' `withLockedOrg`, transaction only, typed result;
  `createTestOrg` and `seed.ts` complimentary by default (`dev-fixture.ts` only reuses the seeded
  org, so no change); `.env.example` and `.env.production.example`; `vitest.stripe.config.mts`,
  `npm run test:stripe`, `harness.stripe.test.ts`. Nothing on a request path reads the new code
  yet except `/a` badges (same function, new import) and the staff actions (same lock).
- **Strings:** none added. No Phase 1 code shows text to a user; §10 lands with Phases 3 to 6.
- **Tests:** typecheck and lint clean; production build passes; full suite **2217 passed, 9
  failed, 21 skipped of 2247** (177 files). All 9 failures and all 21 skips (one suite that errors
  in setup) come from packet generation running `pdftotext -bbox-layout`, which this machine's
  xpdf builds (Git for Windows, MiKTeX) reject. No Poppler is installed here. None of them touches
  billing code. Phase 0's 2171/2171 must have run where Poppler was on the PATH.
  `npm run test:stripe`: fails loudly with no `sk_test_` key; passes (1 test, `livemode` false)
  with the sandbox key supplied through the environment only.
- **Mutation checks** (each broke a test, was restored, and hash-verified): entitlement ignoring
  `stripe_status` (5 failures); ignoring `complimentary_until` (6); billing-off branch removed (2);
  `classifyChange` mixed case (Reconciliation yearly to Reconciliation + AI monthly) returning
  `now` (U-2 fails); the https rule skipped for a live key (config and instrumentation tests
  fail); `ALTER TYPE` or `UPDATE` appended to `0041` (U-1 fails); `.for("update")` removed from `lockOrg` (2 staff
  concurrency tests fail); a field dropped from the `lockOrg` selection (typecheck fails).
- **Migration:** `0041_stripe_billing.sql`: 18 nullable or defaulted `ADD COLUMN`s, one unique
  index, four CHECKs compared on `text` only; no `ALTER TYPE`, `UPDATE`, `DROP` or `ALTER COLUMN`.
  Applied locally. **Rollback rehearsed** on throwaway databases: drop the four CHECKs, the index,
  the 17 `organizations` columns and `org_account_events.via_stripe`, delete the `0041` row from
  `drizzle.__drizzle_migrations`. The schema dump then differs from a fully migrated database by
  exactly the `0041` objects, an existing row survives, and migrating again re-applies `0041` to a
  schema identical to a fresh one.
- **Deviations:** `orgEntitlement(org, today, enabled)` takes the switch as an argument so it
  stays pure. Reasons are `billing_off`, `complimentary`, `subscription` (paid) and `new`,
  `ended`, `complimentary_ended`, `unknown_status` (not paid; `incomplete` and
  `incomplete_expired` count as `new`). `unknown_status` is its own reason so later phases can log
  `ALERT` for it. `activeFundingSourceLimit` takes the entitlement, as P23 says, so billing off
  means no limit. The per-plan number lives in `rules.ts`. There is no `stripe-client.ts` yet
  (Phase 2). Five staff-action tests now pass `complimentary: false` because they assert on or
  grant complimentary access.
- **Security pass:** hostile configs (live key over http, a `javascript:` URL, a key with a newline
  inside it, publishable keys) are refused, and no message contains a value. The sandbox
  key is in no repo file and no build output. Nothing new is exported from a `"use server"` file.
  `stripe` adds no dependencies and no advisory. For Phase 2: validation trims the key, so the
  client must be built from the same trimmed value. A value like `" true"` leaves billing off, the
  same as `SIGNUP_ENABLED`.
- **Not verified:** the 9 packet tests on a machine with Poppler; `next start` booting with billing
  on (the check is covered by unit tests of `register()` only); Linux `npm ci`.

### Phase 2: sync, webhook, safety nets
- `syncOrgBilling`, webhook route, stale re-sync, `billing:reconcile`, `billing:setup`, listener
  script, History rows.

**Passes when:** U-6, U-7, U-9, I-3, I-6, I-8, S-24, S-25, S-26 pass; a sandbox payment through the
CLI listener updates the org within seconds.

**Results (2026-09-25).**
- **Built:** `src/modules/billing/stripe.ts` (client built on first use, never at import, so the app
  starts without keys; pinned API version; `maxNetworkRetries: 2`; shared helpers `idOf`,
  `isMissing`, `subscriptionsOf`, `futurePhase`, `stripeNow`); `lock.ts` (`withLock`, in-process,
  ported unchanged); `sync.ts` (`syncOrgBilling`, the only writer of billing columns, per-customer
  lock, org found by `stripe_customer_id` only and the other mode treated as absent, pure `copyOf`,
  writes under `lockOrg` with no Stripe call inside the transaction, one `via_stripe` History row per
  plan or status change; `refreshOrgBilling(orgId, "stale" | "return")` for the two in-app nets;
  `flagDispute`; `alert()` for every `ALERT`); `webhook.ts` (`handleWebhook`, framework-free,
  `HANDLED_EVENTS`); `app/api/stripe/webhook/route.ts` (503 while off, `readCappedText` 1 MB, 413,
  never parsed before the signature); scripts `billing:setup` (products, prices by lookup key with
  `transfer_lookup_key`, portal configuration: card, invoices, billing details only),
  `billing:reconcile` (exits 1 on any failure), `billing:listen` (dev only, `--api-key`);
  `stripeKeyIsLive()` in `config.ts`; `STRIPE_CLI` in `.env.example`.
- **Tests:** unit `webhook.test.ts`, `copy.test.ts`, `lock.test.ts`, `route.test.ts` (U-6, U-7, U-9)
  and integration `sync.integration.test.ts` (I-3, I-6, I-8, P27, disputes, unknown and other-mode
  customers): 81 + 13 passed. Sandbox `billing.stripe.test.ts`: S-24, S-25, S-26, lost webhook,
  other-mode customer, all passing (`npm run test:stripe` 6 of 6 with the harness test). Typecheck
  and lint clean. Full suite: the only failures are environmental and predate this phase: the
  packet tests that need Poppler's `pdftotext -bbox-layout` (this machine has xpdf), and the
  create-staff and approve-concurrency integration tests timing out under full-parallel load
  (both pass alone).
- **Mutation checks** (each broke a test, then restored): the webhook livemode check removed (2
  failures, U-6); signature verification replaced by `JSON.parse` (6 failures, U-6 and the route
  test); the per-customer sync lock removed (I-3 fails).
- **Deviations:** Stripe lookup keys are `sf360_{plan}_{interval}`, not `{plan}_{interval}`: the
  account is shared (D1) and the reference build already owns the bare keys in the same sandbox,
  and a lookup key is unique per account. **Awaiting the user's approval.** Products are
  `sf360_{plan}`; `PORTAL_TAG` lives in `pricing.ts`. `STRIPE_CLI` is in `.env.example` only, not
  `.env.production.example`, because the listener is development only. `refreshOrgBilling("stale")`
  exists and is tested but nothing calls it yet: the page and layout that should call it belong to
  Phases 4 and 5.
- **Not verified:** a sandbox payment through the CLI listener (no Stripe CLI on this machine);
  the packet tests on a machine with Poppler.

### Phase 3: billing actions
- §4.1 actions, entitlement wired into every AI gate and the header pill, `/r/billing/return`,
  portal configuration, `billing:move-subscribers`.

**Passes when:** S-1 to S-23, S-28 to S-30 pass with the paid-through check; I-2, I-4, I-5, I-17
pass; §8.4 mutations done.

**Results (2026-09-25).**
- **Built:** `src/modules/billing/billing.ts` (every rule, ported from the reference build and keyed
  by organization: `startCheckout`, `quoteChange`, `applyChange`, `cancelPendingChange`,
  `cancelAtPeriodEnd`, `endPlanNow`, `resume`, `portalUrl`, `setCollectionPaused` (D3),
  `planPriceMoves` (P21));
  `src/modules/billing/actions.ts` (the eight §4.1 actions: session, billing switch, admin check
  and a per-user `billing` rate limit inside each, then `BillingError` to its `UI` string and a
  Stripe error to `billingStripeError`); `app/r/billing/return/route.ts` (ignores the query,
  re-syncs the org's own customer, redirects to `/r/settings?section=plan`);
  `billing:move-subscribers` (dry run by default, `--apply`, `--live` for a live key). Entitlement
  in every AI gate: `summariesAccessForOrg`, `readAmountsAllowedForOrg` and a new `aiAllowedForOrg`
  in `src/modules/ai/access.ts` load the billing columns fresh and apply `orgEntitlement`; every AI
  page, action and route already goes through them. Staff actions: `changePlanAction` refuses
  `staffStripeManaged` while billing is on and a subscription is live (P16); suspend and reinstate
  pause and resume collection after their transaction commits, a Stripe failure logs `ALERT` and
  never undoes the suspension (D3). P24: a Reconciliation Checkout, quote or downgrade is refused
  with more than one active funding source before anything is created in Stripe. Strings: one
  `// PHASE-16 Track A (billing actions)` block with the §10 wording.
- **Tests:** unit and integration `billing/actions.integration.test.ts` (I-1, I-2, U-8, U-10,
  U-11, U-21, rate limit, P24), `ai/access.integration.test.ts` (I-4, I-5),
  `admin/actions.p16-d3.integration.test.ts` (P16 part of I-7, D3 wiring): 59 passed. Sandbox
  `npm run test:stripe` **35 of 35** (S-1 to S-30 except S-24 to S-26 already there, plus I-17 and
  the portal), paid-through check after every money step. Typecheck and lint clean; production build passes;
  full suite **2370 passed, 9 failed, 21 skipped of 2400** (185 files), every failure the packet
  generation that needs Poppler's `pdftotext -bbox-layout` (this machine has xpdf), as in Phases 1
  and 2.
- **Mutation checks** (each broke its test, was restored and hash-verified): `create_prorations`
  instead of `always_invoice` (S-2, S-3 fail); no `phase_start` (S-20: the year never billed); no
  `pending_if_incomplete` (S-4: a declined card still switched the plan); no queued-downgrade
  refusal (S-9); no quote-age check (S-14); no `pending_update` refusal (S-4); no P24 count on a
  downgrade (S-27); no admin check (I-2); no complimentary refusal (I-1); no P16 check (I-7).
- **Deviations:** `billingRateLimited` is a new string not in §10. S-23 (retries exhausted) is
  simulated by cancelling in Stripe and syncing: the sandbox's dashboard retry rule can't be read
  from the API, so Stripe's own exhaustion path is not proven. S-28 and S-29 use throwaway prices
  on their own product, so the real `sf360_*` lookup keys are never moved during a concurrent run.
  S-30 (the UNSURE case): pausing and resuming collection leaves a queued downgrade in place;
  what happens when the switch date arrives while paused is not tested. P16 reads our copy of
  `stripe_status` and applies only while billing is on, so staff can still set plans after a
  rollback. A Stripe URL that isn't https `*.stripe.com` throws (a 500), not an `ActionResult`.
- **Fixed in review (2026-09-25):** `planPriceMoves` re-tagged a queued price move as a downgrade
  when prices changed twice before a renewal, which would have blocked that org's upgrades; it now
  keeps the queued phase's own reason. **Not covered by a sandbox test yet** (an S-29 variant with
  two price changes).
- **Left for later phases:** the header Plus pill (`app/r/layout.tsx:78`) and
  `app/r/settings/page.tsx:85` still use `aiPlanAllowed(plan)` and must switch to
  `aiAllowedForOrg`; the billing actions and `/r/billing/return` must go on the unpaid allow-list
  (§4.7); Phase 6's funding-source create and unarchive must refuse while a downgrade to
  Reconciliation is queued (built in the PR #23 review from the org's copy, not a Stripe call). The route-level 403 of I-4 is covered through the shared
  loaders, not by a route test.

### Phase 4: no free use, sign-up, complimentary end

Numbered 5 in the first draft of this plan; renumbered 2026-09-25 to follow the build order (it
was built and committed before the Plan & billing screen).
- §4.7 in full: `pageSession`, guarded `actionSession`/`requireAdmin`, `routeSession`, sharing,
  allow-list, `/r/plan`, sign-up and sign-in order, `complimentary_until` enforced, the static
  guard test.

**Passes when:** U-17, U-18, U-20, I-9 to I-12, I-16 pass; removing any one guard fails U-18;
B-13 to B-16, B-20 done.

**Results (2026-09-25).**
- **Built:** `src/services/auth/entitlement.ts` (`entitlementOf`, `sharesAllowed`, `hasPaidAccess`
  failing closed when billing is on and a session has no entitlement, `ENTITLEMENT_COLUMNS`);
  `resolveSession` attaches the entitlement. `src/lib/page-session.ts` (`pageSession`,
  `planPageSession`, never loops), `src/lib/route-session.ts` (`routeSession` 403 JSON or text,
  `routeSessionAnyPlan`), guarded `actionSession`/`requireAdmin` plus `actionSessionAnyPlan`/
  `requireAdminAnyPlan`; `readSignedInJson` guarded. All 18 `app/r` and onboarding pages, all 11
  direct-session routes, every server action. `/r` layout renders only the header for an unpaid org
  (no org data, no onboarding redirect). Sharing (`public.ts`, `queries.ts`, `actions.ts`) uses
  `sharesAllowed`. Sign-in and sign-up send an unpaid org to `/r/plan` (sign-up keeps a valid
  `plan`/`interval`). `/r/plan` page: chooser, reason headline, manager notice naming the admins.
- **Allow-list as built:** actions `signInAction`, `signOutAction`, `signUpAction`,
  `changePasswordAction`, `listOrgUsersAction`, `revokeUserAccessAction`,
  `archiveFundingSourceAction`, `src/modules/billing/actions.ts#*`; routes `/api/me/avatar`,
  `app/r/billing/`, `app/api/stripe/`, `app/s/` (via `loadPublicShare`). Staff `/a` uses
  `requireStaff`.
- **Deviations:** the unpaid refusal from `actionSession` reuses the `expired` key (about 70 callers
  already stop on it) rather than `denied`; `requireAdmin` returns `denied` as specified.
  `archiveFundingSourceAction` is on the list but still calls the guarded `actionSession()`
  (`funding-sources/` is outside this track): D2 archiving from the plan page needs it switched to
  `actionSessionAnyPlan()` in Phase 6. The Subscribe button on `/r/plan` is disabled until
  `startCheckoutAction` exists.
- **Tests:** U-17 (`page-session`, `route-session`, `action-session-billing`), U-18
  (`guard-coverage`, TypeScript AST over every `"use server"` export, page and route method), U-20
  (`access-columns`), I-9 to I-12 and I-16 (`no-free-use.integration`, real Postgres; I-9 covers one
  action per module, all four download routes, a files route, a `readSignedInJson` route, a page
  and a shared link; I-11 checksums all 25 org-scoped tables). U-21's entitlement part stays in
  `billing/entitlement.test.ts`.
- **Mutations** (each failed, then restored): a page back to `getSession` (U-18); an action to
  `actionSessionAnyPlan` in settings and in recurring (U-18); the packet route to
  `routeSessionAnyPlan` (U-18, I-9); `complimentary_until` ignored (I-10); the billing-off branch
  in `hasPaidAccess` and `sharesAllowed` (I-16).
- **Checks:** typecheck and lint clean; `next build` passes; full suite 2302 passed, 21 skipped,
  9 failed, all 9 the known `pdftotext -bbox-layout` failures on this machine (packet download
  routes 1, sharing actions 3, public shared-link routes 5), which fail the same way alone.
- **Not verified:** B-13 to B-16 and B-20 in a browser; the real Checkout path (Track A).
- **Merged onto Phase 3 and reviewed (2026-09-25):** the billing actions used the guarded
  `actionSession()`, so an unpaid admin's Subscribe would have been refused and nobody could pay;
  they now use `actionSessionAnyPlan()` (the file is allow-listed; each action still checks admin
  itself). `/r/plan`'s Subscribe is wired to `startCheckoutAction` (`subscribe-button.tsx`, label
  "Opening the payment page…" while it works). `src/modules/ai/access.ts` had its own copy of the
  entitlement columns and helper, which `access-columns.test.ts` (U-20) caught; it now reuses
  `ENTITLEMENT_COLUMNS` and `entitlementOf`. Checks after the merge: typecheck clean; 447 of 447
  tests in `src/lib`, `src/services/auth`, `src/modules/billing`, `src/modules/ai` and the string
  tests. Left for Phase 5: the "Payment wasn't finished" note on `/r/plan?checkout=cancelled`.

### Phase 5: Plan & billing UI, Plus pill, banners, staff dashboard

Numbered 4 in the first draft of this plan (see Phase 4).

- §4.3 to §4.6, the Settings tour step (8 → 9 steps, test updated), m09 and m10 docs.
- Carried in from Phases 2 to 4:
  - the header Plus pill (`app/r/layout.tsx`) and `app/r/settings/page.tsx` still decide AI from
    the plan label; both switch to the entitlement (paid, on Reconciliation + AI);
  - "Payment wasn't finished. Nothing was charged." on `/r/plan?checkout=cancelled`;
  - the stale re-sync (`refreshOrgBilling(orgId, "stale")`) called from the Plan & billing section
    so a lost webhook is repaired when an admin opens it;
  - `/a`: plan and status controls disabled with `staffStripeManaged` for an org with a live
    subscription (the server already refuses, Phase 3), "Stripe" as the actor on `via_stripe`
    History rows, billing interval and renewal date, a queued change or failed payment, the
    `dispute` flag, and the complimentary-on-a-paying-org choice (cancel now or at period end);
  - after a customer is deleted in Stripe, `/a` should not keep showing "Active" (Phase 2 review).

**Passes when:** U-14, U-16, I-7 pass; B-1 to B-12 in Chrome at 1280, 768, 375 px; usability
checklist clear.

**Results (2026-09-25).**
- **Built:** `src/modules/billing/plan-view.ts` (pure `planBillingView`, every §4.3 state) and
  `plan-view-loader.ts` (`loadPlanBilling`, `loadBillingBanner`, `activeAdminNames`; both call the
  stale re-sync); `app/r/plan-billing-section.tsx` (states, switch with Stripe's quote in
  a dialog, cancel, keep, end now, cancel a queued change, Card and invoices, Reconciliation
  disabled with more than one active source); `src/modules/settings/sections.ts` (`?section=`);
  `app/r/billing-banner.tsx`; `app/r/see-plans-link.tsx` beside the Plus notes; the header Plus
  pill and `settings/page.tsx` read the entitlement; `PlusBadge` takes an `href`, only the header
  passes one; `/r/plan?checkout=cancelled` note. Staff `/a`: Billing card (`staffBilling()` in
  `admin/directory.ts`) with status, interval, renewal or end, queued change, warnings for failed
  payment, upgrade waiting, paused collection and a card dispute (a date since D-125), and an "Open in Stripe" link;
  Change plan disabled with `staffStripeManaged` while live; History shows "Stripe" on
  `via_stripe` rows; complimentary for a paying org asks to cancel now or at period end
  (`staffCancelSubscription` in `billing.ts`, Stripe first, outside the row lock, a failure grants
  nothing). Sync: when the customer or every subscription is gone and the stored status was
  live, `copyOf` writes `subscription_status = cancelled` once, so `/a` stops showing "Active".
  Settings tour 8 → 9 steps (`settings-plan`). m09 and m10 docs.
- **Tests:** U-13 (`settings/sections.test.ts`), U-14 (`billing/plan-view.test.ts`, every state
  plus a source check of each state's text and actions), U-16 (`ui/plus-badge.test.ts`), I-7
  (`admin/actions.p16-d3.integration.test.ts`, 25 tests), `staffBilling` and the "Stripe" actor
  in `admin/directory.test.ts`, the deleted-customer cases in `billing/copy.test.ts`. Affected
  files: 48 files, 772 tests passed.
- **Mutation checks:** the deleted-customer write removed (5 `copy.test.ts` cases fail); the
  complimentary cancel check bypassed (5 I-7 cases fail). Both restored.
- **Deviations:** the banner stays visible while Plan & billing is open (the layout can't read
  `searchParams`); "Renews on {date}." has no amount; the upgrade-waiting notice doesn't name the
  target plan (it isn't stored). Staff "cancel now" gives no refund for the unused period and
  voids open invoices. The existing `copy.test.ts` case that expected no status write for a
  deleted customer with a live previous status encoded the bug and was changed.
- **Not verified:** B-1 to B-12 in a browser (the browser tool was unavailable);
  `staffCancelSubscription` against the Stripe sandbox (mocked in I-7).
- **Changed after the user's first test run (2026-09-25):** the plan chooser (`/r/plan`) and
  Plan & billing both show the landing page's pricing cards (`src/modules/landing/plan-cards.tsx`,
  shared with the landing page, so there is one copy); Plan & billing is a plan summary plus the
  cards with a Monthly/Yearly toggle, each card carrying its own Switch plan / Continue to payment
  / Your plan button, and the complimentary ending warning is only the page banner (no repeat in
  the section). Checkout is branded "Stay Funded 360" in the app's colours, always in USD
  (`adaptive_pricing` off; Stripe had shown PKR), with a note under the pay button. D5: a
  complimentary org can buy a plan. Tests: U-14 extended (every complimentary shape), rules
  (`dayAfterStart` across both clock changes, the 49-hour boundary), `endsComplimentaryAt`,
  I-1 rewritten for D5, sync integration (paid ends a grant older than the subscription, never a
  later one, idempotent). Mutation checks: the later-grant guard removed (1 fails), the plan pin
  removed (1 fails). Sandbox: Stripe accepted the branding and USD settings, and refused a
  `trial_end` under 48 hours (hence the 49-hour minimum).

### Phase 6: one funding source on Reconciliation
- §4.8, the Checkout refusal and archive-from-plan-page (D2).

**Passes when:** I-13 to I-15, S-27 pass; B-17, B-19 done; mutation-checked.

**Results (2026-09-25). Partial: §4.8 core only.**
- **Built:** `src/modules/funding-sources/limit.ts`: `fundingSourceLimitRefusal` (pure: admin
  or manager wording, and a `queuedDowngradeAt` branch that nothing passes yet),
  `lockedOrgEntitlement` (the entitlement read through Phase 1's `lockOrg`, `FOR UPDATE`) and
  `loadFundingSourceLimit` (an unlocked read, used only to render Settings).
  `createFundingSourceAction` and `unarchiveFundingSourceAction` now count active sources and
  write in one transaction under the org lock. Unarchiving a source that is already active returns
  ok without doing anything. Settings → Funding sources disables **Add funding source** and
  **Unarchive** at the limit, with the reason under them (`aria-describedby`): admins see
  `fundingSourceLimitReached` + **See plans** (`/r/settings?section=plan`), managers see
  `fundingSourceLimitManager`. The four §10 strings were added verbatim and pinned in
  `strings.test.ts`. Billing off means no limit, so nothing changes today.
- **Built in the PR #23 review (2026-09-26):** the queued-downgrade refusal (I-14). Create and
  unarchive read the org's copy under the org row lock (`lockedOrgEntitlement`: `pending_reason`
  downgrade to Reconciliation, not yet started) and refuse with `fundingSourceLimitQueued` while
  one is queued. `applyChange` re-syncs the copy right after it schedules the downgrade, so no
  Stripe call is made on every source added. The Add button isn't disabled ahead of time for it:
  the refusal shows when the admin saves.
- **Also built in the review:** D2. With more than one active source, Checkout to Reconciliation
  refuses (`billingSubscribeTooManySources`). In Plan & billing the card is disabled with that
  reason under it, since Funding sources is one section away. **Changed 2026-09-28:** on
  `/r/plan` nothing is listed up front; choosing Reconciliation asks "Which funding source do you
  want to keep?", archives the others (`archiveFundingSourceAction`, any-plan session: an unpaid
  org's admin may archive, a manager may not), then opens Checkout. The dialog says plainly that
  the archived sources come back only by switching to Reconciliation + AI, which is true on
  Reconciliation: unarchiving is refused at the limit, and the last active source can't be
  archived, so the kept source can't be swapped either (a product question for later).
- **After the merge (2026-09-28):** `reconciliationStartsOn` (`src/modules/billing/entitlement.ts`)
  is the one answer to "when does this org move onto Reconciliation" (a queued downgrade). A plan
  bought during complimentary access is not a case: it starts the day it is paid for (D-128).
- **Not built (remaining for Phase 6):** S-27, and the `/a` warning for an org over the limit.
- **Tests:** 12 unit (`limit.test.ts`) and 15 integration (I-13: admin and manager refusals, no
  row written, unarchive refused and left archived, an org already over the limit, 5 concurrent
  creates and 5 concurrent unarchives each leaving exactly one active, repeated;
  Reconciliation + AI, complimentary on either plan, billing off unlimited;
  `loadFundingSourceLimit`). Suite counts are under Phase 7 (same tree).
- **Mutation checks** (each broke a test and was restored, hash-verified): the org read done
  without the lock (both concurrency tests fail); the refusal removed from unarchive (3 fail).
- **Not verified:** B-17 in a browser (the rendered state is covered only by reading the
  component; no screenshot).
- **Merged onto Phase 5 (2026-09-25):** three-way merge from the Track C worktree; conflicts only
  in `strings.ts` (both blocks kept, Track C's duplicate `billingSeePlans` dropped),
  `settings/page.tsx` and `settings-sections.tsx` (both sides' props kept; `readAmounts` keeps
  Phase 5's entitlement check). U-20 then caught `limit.ts` listing the billing columns itself;
  it now uses `ENTITLEMENT_COLUMNS` and `entitlementOf`. (U-20 also caught Phase 5's view state
  named `"complimentary"`, renamed `"complimentaryAccess"`.) Typecheck and lint clean; 89 test
  files, 1237 tests across the merged and Phase 5 areas pass.

### Phase 7: prices and the landing page
- §4.9, O3 and O5.

**Passes when:** U-19, S-26 pass; B-18 at 1280, 768, 375 px; structured data validates.

**Results (2026-09-25).**
- **Built:** `src/modules/landing/plan-links.ts`: `planPriceLabel` (never rounds),
  `yearlySavingCents` (`null` while yearly is 12 × monthly), `DEMO_REQUEST_HREF`, and
  `getStartedHref` (checks plan and interval against `PRICES_CENTS`, has no return-to
  parameter). `app/page.tsx` passes `PRICES_CENTS` and `signupEnabled()` (read at request time
  through `connection()`, so `/` is now dynamic) and builds the JSON-LD offers from the
  constants, monthly and yearly (`UnitPriceSpecification`). The landing cards, the AI-section
  price and the FAQ answer (and its FAQPage JSON-LD) all read the constants. There is a
  Monthly/Yearly toggle (default Monthly, `aria-pressed`); "/ year" shows, with a saving only
  when there is one. Each card has **Get Started with …** (`/signup?plan=…&interval=…` when
  sign-up is open) and **Book a demo**. The closing section has **Book a demo** (was "Request
  a demo") and no "Join early access". The header gains **Sign in** (`/login`), and its
  **Get Started** follows the sign-up switch.
- **O5:** settled with no change. The AI section's three claims (milestone synthesis, variance
  notes, board briefings) keep the client's wording; only the price in "Included in
  Reconciliation + AI" now comes from the constants.
- **Tests:** typecheck and lint clean; production build passes; full suite **2267 passed, 9
  failed, 21 skipped of 2297** (181 files, database `ngo_track_c`). The 9 failures and 21 skips
  are the same packet and shared-link tests as Phase 1 (`pdftotext -bbox-layout` on xpdf).
  New: `plan-links.test.ts` (11), `landing-page.render.test.ts` (9),
  `no-price-literals.test.ts` (U-19, 2).
- **Mutation check:** `$297` hard-coded in the Reconciliation card fails U-19; restored and
  hash-verified.
- **Deviation:** while sign-up is closed, **Get started** goes to `#schedule-walkthrough`, the
  closing section whose button is the demo request, not straight to the `mailto:`. AC-P4 is met
  in spirit only; swap to `DEMO_REQUEST_HREF` if the spec is meant literally.
- **Not verified:** S-26 (needs Phase 2's `billing:setup` and the sandbox); JSON-LD against a
  structured-data validator; B-18 at 768 and 1280 px, and with sign-up open (only the 375 px
  header was checked, by the earlier session).

### Phase 8: go-live
- §11 in order, each step recorded; deploy with the `TASKS.md` S-row; the prod-release routine.

**Passes when:** AC-M1.

---

## 8. Tests and verification

### 8.1 Unit (U), pure, no database
- **U-1** Migration `0041`: only nullable or defaulted adds, no `ALTER TYPE`, no enum literal in a CHECK, no `UPDATE`.
- **U-2** `classifyChange`: all 16 pairs.
- **U-3** Features per plan.
- **U-4** `orgEntitlement` for billing on and off, suspended, complimentary (none, open, until today, until yesterday, with and without `complimentary_plan`), every `stripe_status` and null and an unknown one.
- **U-5** Startup check: on/off, missing, malformed, publishable key, live key on http.
- **U-6** Webhook: missing, forged, wrong secret, tampered, replayed, wrong mode, malformed JSON → 400, no sync; billing off → 503; unknown customer → 200 with no Stripe call; sync throws → 500; each handled event syncs.
- **U-7** Sync mapping: status mapping from live subscriptions only, dead subscription never overwrites a complimentary plan, unknown status, cancel flag inside and beyond the period, price without metadata, `pickCurrent`, other-mode customer id, lock ordering.
- **U-8** Action errors: `BillingError`, Stripe error, failed refresh after success.
- **U-9** `ALERT` for two live subscriptions, unknown status, dispute.
- **U-10** No billing action accepts an id.
- **U-11** Redirect targets.
- **U-12** Price display; archived or missing price.
- **U-13** `?section=` parsing.
- **U-14** Every §4.3 state → text and actions (source-reading screen test).
- **U-15** New strings pass `strings.test.ts` and `no-dashes.test.ts`.
- **U-16** Only the header `PlusBadge` has `href`.
- **U-17** `pageSession`: unpaid admin → `/r/plan`, manager → notice, never the page's data.
- **U-18** Static guard coverage: every `"use server"` export, every `app/r` and onboarding page, every route method is guarded or allow-listed; `*AnyPlan` helpers only from allow-listed entries.
- **U-19** No price literal outside `pricing.ts` (grep).
- **U-20** No file outside `entitlement.ts` reads `stripe_status`, `complimentary` or `subscription_status` to decide access (grep).
- **U-21** Billing off: entitlement paid, limit off, actions refuse.

### 8.2 Integration (I), real Postgres, never counted when skipped
- **I-1** Complimentary org: billing actions refuse, no Stripe call (client stubbed to fail).
- **I-2** Manager: every billing action refuses; role re-checked.
- **I-3** Out-of-order syncs end in the newest state.
- **I-4** Cancelled Plus org: AI actions refuse, the 4 AI routes 403.
- **I-5** past_due Plus org keeps AI.
- **I-6** History: one `via_stripe` row per change; none for no change.
- **I-7** `/a`: plan/status refused with a live subscription, allowed after it lapses; complimentary on a paying org asks for the cancel choice.
- **I-8** Stale re-sync throttled; Stripe failure keeps the copy.
- **I-9** Unpaid org: actions from every module, every download route, a page render and a shared link refuse; allow-listed entries work.
- **I-10** Complimentary until today paid, yesterday unpaid, null paid.
- **I-11** Unpaid then paid: every row unchanged (counts and checksums).
- **I-12** Sign-up unpaid can't onboard; after payment it can; no loop.
- **I-13** Funding sources on Reconciliation: create and unarchive refused, concurrent attempts allow one; Reconciliation + AI unlimited.
- **I-14** Downgrade refused with two sources; queued downgrade blocks adding; nothing archived.
- **I-15** Reconciliation Checkout refused with more than one source; archive from the plan page works while unpaid.
- **I-16** Billing off: every existing behaviour, webhook 503.
- **I-17** Customer email follows the current admin.

### 8.3 Stripe sandbox (S): `npm run test:stripe`
`src/**/*.stripe.test.ts`, excluded from `npm test`, its own `vitest.stripe.config.mts` (600 s
timeouts, concurrency 25), throws (never skips) without a `sk_test_` key and a database. Fixtures
build Postgres orgs through `createTestOrg` with complimentary off. **Paid-through check** after
every money step: paid lines, net of refunds, cover the whole current period for the current plan
(the old price of the same plan counts after a price move).
- **S-1** to **S-25** as proven in the reference build: Checkout and one open session; upgrade mid-month; monthly to yearly; declined upgrade (blocked changes, expiry, never charged later); declined then paid; downgrade; downgrade cancelled; yearly to monthly; upgrade refused while queued; cancel, undo, end; cancel drops a queued downgrade; renewal; failed renewal and recovery; guards; double-click; lost webhook; 3-D Secure; end plan now; processing blocks Checkout; mixed downgrade; after a downgrade; dashboard `cancel_at`; retries exhausted (sandbox dashboard rule); idempotent sync; deleted customer.
- **S-26** Active prices equal `pricing.ts`, with metadata, interval, USD, one per lookup key.
- **S-27** Downgrade to Reconciliation with two sources refused before any schedule exists.
- **S-28** Price change: new subscriber pays the new price; existing renews at the old.
- **S-29** `billing:move-subscribers`: dry run changes nothing and lists skipped; real run at next renewal; queued downgrades rewritten; cancelling a queued change keeps the price move.
- **S-30** Suspend pauses collection; reinstate resumes; with a queued change (UNSURE, settled here).

### 8.4 Mutation checks
Remove the admin check; the complimentary refusal; `always_invoice` → `create_prorations` (S-2,
S-3 fail); remove `phase_start` (S-20); remove `pending_if_incomplete` (S-4); the queued-downgrade
refusal (S-9); the `pending_update` refusal (S-4); the quote-age check (S-14); the livemode and
signature checks (U-6); entitlement ignoring `stripe_status` (I-4); the sync lock (U-7); one
page, action or route guard (U-18, I-9); `complimentary_until` (I-10); the limit on unarchive
(I-13); the queued-downgrade refusal on create (I-14); a hard-coded landing price (U-19); the
billing-off branch (I-16).

### 8.5 Browser (B), Chrome at 1280, 768 and 375 px, sandbox Stripe
- **B-1** Chooser, toggle, prices. **B-2** Subscribe with 4242, processing note, active, header pill.
- **B-3** Switch cards and dialog; Escape changes nothing. **B-4** Cancel dialog and Keep my plan.
- **B-5** Payment failed (test clock): banner, panel, portal, End plan now dialog.
- **B-6** Upgrade awaiting payment. **B-7** `?section=`. **B-8** Manager view. **B-9** Keyboard, 44px, 375px, dialogs fit.
- **B-10** Header pill. **B-11** See plans for base-plan admins. **B-12** Copy of real data: Team Pursuit Global unchanged.
- **B-13** Unpaid admin and manager; Sign out. **B-14** Download and shared link refused.
- **B-15** Pay; bookmarks work again. **B-16** Sign-up from a landing button to the app.
- **B-17** Funding-source limit disabled with reason. **B-18** Landing, sign-up closed and open.
- **B-19** Archive from the plan page, then Reconciliation Checkout. **B-20** Complimentary ending banner.

**Not verified by this plan:** Edge and Safari; bank debits; coupons, tax, currencies; more than one app process.

---

## 9. Env

| Variable | Where | Without it |
|---|---|---|
| `BILLING_ENABLED` | `.env.local`, server `.env` (default `false`) | Billing stays off; everyone keeps today's access |
| `STRIPE_SECRET_KEY` | same | Required only when billing is on |
| `STRIPE_WEBHOOK_SECRET` | same | Required only when billing is on |
| `STRIPE_CLI` | `.env.local`, optional | `billing:listen` can't find the CLI |

All four go in `.env.example` and `.env.production.example`. The live `.env` is edited by hand
and takes effect with `./deploy.sh --env-only`; a `TASKS.md` S-row names them before Phase 8.

---

## 10. Strings (UI, in `src/domain/strings.ts`)

From the usability review, wording to confirm with the client; canonical rows go into domain-rules
§12 as `billing-*` keys cited `(PHASE-16 §10)`.

| Key | Text |
|---|---|
| billingSectionTitle | Plan & billing |
| billingNotEnabled | Plan and billing will be available here soon. |
| billingComplimentary | Your organization has complimentary access to {plan}. |
| billingComplimentaryUntil | Your organization has complimentary access to {plan} until {date}. |
| billingQuestions | Questions about your plan? Email {support}. |
| billingCompEnding | Your complimentary access ends on {date}. Choose a plan before then to keep working without a break. |
| billingChooseFor | Choose a plan for {org} |
| billingChooseNew | Choose a plan to get started. |
| billingEnded | Your plan has ended. Your records are safe and come back as soon as you choose a plan. |
| billingCompEnded | Your complimentary access ended on {date}. Your records are safe and come back as soon as you choose a plan. |
| billingSubscribe | Continue to payment |
| billingOpeningCheckout | Opening the payment page… |
| billingCheckoutAbandoned | Payment wasn't finished. Nothing was charged. |
| billingProcessing | Your payment is going through. This page updates when it's done. |
| billingConfirming | Confirming your payment… |
| billingBilledMonthly / billingBilledYearly | Billed monthly / Billed yearly |
| billingRenews | Renews on {date} for {amount}. |
| billingSwitchPlan / billingYourPlan | Switch plan / Your plan |
| billingPortal / billingPortalHelp / billingOpeningPortal | Card and invoices / Opens Stripe's secure page. / Opening Stripe… |
| billingCancelPlan / billingKeepPlan | Cancel plan / Keep my plan |
| billingDowngradeQueued | On {date}, your plan switches to {plan}, billed {monthly/yearly}. |
| billingPriceMoveQueued | From {date}, {plan} is {amount} per {month/year}. |
| billingCancelChange | Cancel this change |
| billingCancelling | Your plan is cancelled. You keep access until {date}. |
| billingUpgradeWaiting | Your switch to {plan} is waiting for payment. Pay by {time} on {date} to finish it. If you don't, nothing changes and nothing is charged. |
| billingPayNow | Pay now |
| billingPaymentFailed | Your last payment didn't go through. You still have access while we try the card again. Update your card to keep it. |
| billingPaymentFailedManager | Your organization's last payment didn't go through. Your admin ({names}) can update the card. |
| billingEndNow | End plan now |
| billingManagerNote | Only an admin can change the plan or billing. |
| billingUnpaidManager | Your organization doesn't have an active plan. Your admin ({names}) can choose one in Plan & billing. |
| billingSwitchTitle | Switch to {plan}, billed {monthly/yearly}? |
| billingRow* | Current plan / New plan / Changes / Charged today / After that |
| billingChangesNow / billingAfterThat | Right away / {amount} per {month/year} from {date} |
| billingUpgradeExplain | Today's charge covers {plan} until {date}, less the unused part of what you already paid. |
| billingDowngradeExplain | You keep {plan} until then. Nothing is charged today, and you can cancel this change any time before it starts. |
| billingConfirmPay / billingConfirmSchedule / billingSwitching | Pay {amount} and switch / Switch on {date} / Switching… |
| billingCancelTitle | Cancel your plan? |
| billingCancelBody | You keep full access until {date}. After that, no one in your organization can open the app, download packets or use shared links until you choose a plan again. Your records are kept. |
| billingEndNowTitle | End your plan now? |
| billingEndNowBody | Your last payment didn't go through, so ending your plan now cancels that bill. No one in your organization can use the app until you choose a plan again. Your records are kept. |
| billingNotAdmin | Only an admin can change the plan or billing. |
| billingComplimentaryRefused | Your organization has complimentary access, so there's nothing to pay. |
| billingAlreadySubscribed | Your organization already has a plan. Use Switch plan to change it. |
| billingPaymentProcessing | Your last payment is still going through. Try again once it's done. |
| billingUnknownPlan | That plan isn't available right now. |
| billingNoPlan | Your organization doesn't have a plan yet. |
| billingPaymentFailedRefused | Your last payment didn't go through. Update your card before changing plans. |
| billingCancelPending | Your plan is cancelled. Press Keep my plan before switching. |
| billingPaymentPending | A switch is waiting for payment. Pay for it or let it expire before making another change. |
| billingChangePending | A switch is already scheduled. Cancel it first. |
| billingSamePlan | That's your current plan. |
| billingQuoteExpired | The price has changed since you opened this. Open it again to see the new figures. |
| billingPortalNotSetUp | Card and invoices aren't available yet. Email {support}. |
| billingStripeError | The payment service didn't respond. Check your plan below before trying again. |
| billingPlanRequired | Your organization's plan has ended, so this wasn't saved. Reload the page to see your options. |
| billingDowngradeTooManySources | Reconciliation includes one active funding source, and you have {n}. Archive the ones you don't use in Funding sources, then switch. |
| fundingSourceLimitReached | Reconciliation includes one active funding source. To add more, try Plus. |
| fundingSourceLimitManager | Reconciliation includes one active funding source. Ask your admin about upgrading. |
| fundingSourceLimitQueued | Your plan switches to Reconciliation on {date}, which includes one active funding source. To add another, cancel that switch in Plan & billing. |
| billingSeePlans / billingGoToSources | See plans / Go to Funding sources |
| plusPillLabel | Plus plan, open Plan & billing |
| staffStripeManaged | Billing for this organization is managed in Stripe. |

---

## 11. Going live (outside the code)

0. **D1 (existing account):** the dev team's Developer role; confirm the payout bank account, the
   business name on receipts and the statement descriptor are right for Team Pursuit; before
   changing any account-wide setting (steps 3, 5, 6), confirm nothing else on the account relies on
   the current value.
1. Account activation: business details, Team Pursuit's bank, identity.
2. Terms, refund and privacy pages if Stripe asks.
3. Public details: name, support email, statement descriptor. Adaptive Pricing and automatic tax off.
4. Webhook endpoint `https://reconciliation.teampursuit.org/api/stripe/webhook`, API version pinned
   to the SDK's (P26), exactly the events in `HANDLED_EVENTS`; copy its signing secret.
5. **Required:** after the last failed retry, cancel the subscription. Screenshot recorded.
6. Receipts, failed-payment and 3-D Secure emails on.
7. **Before switching billing on (read-only queries on production, recorded):** orgs with a
   `complimentary_until`; orgs neither complimentary nor paying; Reconciliation orgs with more than
   one active source. Each resolved with staff.
8. Server `.env`: `STRIPE_SECRET_KEY` (live), `STRIPE_WEBHOOK_SECRET`; `pricing.ts` confirmed (O1);
   O4 chosen; then `docker compose -f docker-compose.prod.yml exec -T app npm run billing:setup -- --live`.
9. Host crontab next to `backup.sh`:
   `30 3 * * * cd ~/ngo-expenses && docker compose -f docker-compose.prod.yml exec -T app npm run --silent billing:reconcile >> ~/billing-reconcile.log 2>&1`.
10. `BILLING_ENABLED=true`, `./deploy.sh --env-only`.
11. One real payment on the cheapest plan with a team card; see it in the app and `/a`; webhook
    page shows 200; cancel now and refund. Watch the log for `ALERT`.

**Rollback:** `BILLING_ENABLED=false` and `./deploy.sh --env-only`: everyone keeps today's access,
billing actions refuse, webhooks get 503 and Stripe retries them later. Paid subscriptions keep
running in Stripe; pause, cancel or refund them there. Reverting code or the migration is not needed
to switch billing off.

---

## 12. Reference build

`C:\Users\Usman Masood\stripe-playground` (outside the repo, one machine): the small app used to
prove these rules. Its `lib/*.ts` and `tests/billing.test.ts` are what Phases 1 to 3 port (the test
moves from `node:test` on SQLite to vitest on Postgres orgs; scripts run with `tsx` here). **Push it
to a private repo** before Phase 1 so the team can read it.

---

## 13. Plan review (2026-09-25)

Five reviewers read the plan against the code. What changed because of them:

| Lens | Found | Changed |
|---|---|---|
| Author's own pass | Startup check vs rollback; lapsed-org loophole; stale placeholders; `pricing.ts` in the wrong phase; onboarding before the paywall; no timezone for "today" | P25, D2, §4.3 copy, Phase 1, §4.7 order, §4.2 |
| Database | Create and unarchive take no lock; `withLockedOrg` not reusable; an 8-value CHECK could fail webhooks forever; staff and sync both writing status between phases | P12, P8, P16, §3 |
| Security | The single guard missed every page and 13 of 19 routes; a layout gate leaks page data; throwing inside `requireSession` breaks sign-up and 500s actions; sharing reads status itself; five actions not marked admin-only; webhook body reader would 403 Stripe | P22, §4.7, §4.1 |
| Feasibility | Redirect loop for new sign-ups; test orgs would hit the paywall (25 to 35 files); scripts and cron in Docker; landing is a client component; Stripe tests must not skip silently | P28, §4.7, §8.3, §11, §4.9 |
| Usability | "Cancel" on a cancel dialog; no dialog for ending now; no warning before complimentary ends; new sign-ups told their plan "has ended"; four missing states; disabled buttons must say why; managers need the admins' names | §4.3 to §4.8, §10, D4 |
| Billing | Shared Stripe account; phases before go-live; complimentary vs Stripe fighting over `plan`; suspended orgs still charged; price moves vs schedules; new prices missing metadata; retries-exhausted and disputes; SDK version | D1, D3, P21, P25, P26, P27, S-26 to S-30 |

---

## 14. PR #24 review fixes (2026-09-28, branch `review/pr-24-fixes`)

PR #24 (`fix/complimentary-billing`, Usman) moved buying during complimentary access to "pay today,
the free access ends once paid" (D-128), made `/r/plan` ask which source to keep, added Total paid
to the staff Billing card, restyled Settings → Funding sources and the landing icons, and animated
every dialog. Its review (2026-09-28) found no problem with D-128 itself. This section is the plan
for every finding, built on a branch of its own off the PR.

### 14.1 Fixes

**A. Dialogs and modals** (`src/components/ui/overlay-shell.tsx`, `dialog.tsx`, `modal.tsx`, `app/globals.css`)

| # | Finding | Fix | Passing criteria |
|---|---|---|---|
| A1 | A fading overlay still holds the scroll lock, the page's `inert` marks, the stacking entry and Escape for 160 ms, so an overlay opened in the same click records "locked" as the page's normal state: Packet, a month with a deleted expense, Share link, Continue, then close Share leaves the page unable to scroll, and Tab can leave the Share dialog | Every page-level effect runs while `open && !closing` ("active"), so it is released in the commit that starts the fade, before anything opened in the same click mounts (React runs every passive cleanup before any new effect in one commit) | 60 ms into a fade: `document.body.style.overflow` is back to what it was, and the page is not inert |
| A2 | During the fade the confirm button stays enabled and focused, and only the mouse is blocked, so a second Enter reruns a `ConfirmButton` action (Delete permanently, Stop sharing, Remove document, Write again) | The fading overlay renders `inert` | 60 ms into a fade: every button in it is inside an `inert` element, and focus is not inside it |
| A3 | Found in the review, older than the PR: focus comes back to the page body, not to the button that opened the overlay, because the focus-return cleanup ran while the page was still inert | One effect captures the focused element before marking the page inert, and on release removes `inert` first, then restores focus | After closing, `document.activeElement` is the trigger |
| A4 | Under reduced motion the page ignored clicks and keys for 160 ms; the comment called the overlay click-through | After A1 and A2 the fading overlay is inert and the page is live again, so nothing is left to fix in code: the comment is corrected | Read |
| A5 | Five popups are rendered only while open (`{x && <C/>}` around `<Modal open>`), so they appear with the fade but vanish on close: Share link, the expense History popup, expense details, Line Items' Manage, the avatar cropper | Expense details (stateless) and Manage (state in the parent) stay mounted with `<Modal open={x !== null}>{x && body}</Modal>`: the Modal already keeps its last content through the fade. Share, History and the cropper hold their own state, so their parents keep them mounted through the fade with `useOverlayPresence`, which gains a count of opens used as the component's `key` (a fresh component each time it opens). Lands after A1 | Each closes with the fade; each reopens empty |
| A6 | The presence logic has no test; `.pop-in`'s comment still says it animates dialogs | The state change becomes a pure function (`nextPresence`) with unit tests; the comment is fixed. vitest has no DOM, so A1 to A3 and A5 are checked in Chrome (§8.5), once with the fix reverted | Tests fail when it is broken; the browser checks fail on the old code |

**B. Billing** (`src/modules/billing/*`, `app/r/plan-billing-section.tsx`, `app/r/subscribe-button.tsx`, `app/r/plan/page.tsx`)

| # | Finding | Fix | Passing criteria |
|---|---|---|---|
| B1 | A complimentary org whose paid plan is still running out (staff chose "cancel at the end of the paid period") is offered Subscribe, which Checkout refuses with "Use Switch plan", a button that doesn't exist while complimentary; Card and invoices is gone | `planBillingView` adds `paidPlan` to the complimentary view when the Stripe copy is live. The section says "Your paid {plan} plan ends on {date}. Your complimentary access continues." or, if it would renew (a grant made while Stripe couldn't be reached), "…renews on {date}." with **Cancel plan**, whose dialog says the complimentary access continues. Subscribe and "You can choose a plan now" are hidden; Card and invoices stays | Unit tests for the view |
| B2 | The keep-one dialog archives the other sources before Checkout: backing out, or a refusal after archiving, leaves them archived with no plan, and an unpaid org can't reach Settings to see it | **Keep one source when the payment goes through** (D-129). A Reconciliation Checkout records the source to keep in the subscription's metadata (`keepFundingSource`): the admin's choice when several are active (a uuid of an active source of this org, refused otherwise, with its own message), the only active source otherwise; a Reconciliation + AI Checkout records nothing. Nothing is archived at Checkout. **Once only:** on the sync that first writes this subscription as paid (the previous copy not live, the new status `active`), when its price is Reconciliation and the org is not complimentary after that write, every other active source is archived in the same transaction. The metadata stays on the subscription for good and syncs run everywhere (the webhook, pages, the nightly reconcile, staff actions), so a standing rule would archive sources added later, for example while billing was switched off (§4.8 keeps an org's extra sources). The helper is a new `src/modules/funding-sources/archive.ts` that takes `tx`, scopes by org, clears a header selection pointing at an archived source, and revalidates nothing (the sync runs outside a request); `archiveFundingSourceAction` uses it too. A kept source no longer active: the first active one by the list order is kept, and a line is logged | Integration: Checkout records the right id, refuses a missing, foreign or archived one, and archives nothing; the first paid sync archives the rest and clears the header selection; a second sync archives nothing; nothing happens on Reconciliation + AI, before payment, with one source, or while a later staff grant keeps the org complimentary |
| B3 | A complimentary Reconciliation + AI org with one source can open Reconciliation Checkout (open for 24 hours), add sources in another tab, then pay, and land on Reconciliation with several; the PR's docs say this gap is closed | Closed by B2: sources added while Checkout was open are archived when the payment goes through | Integration test of exactly that sequence |
| B4 | The marker that ends the free access on payment is set only if the org was complimentary when Checkout opened: a grant made while an unpaid org's Checkout is open is never ended, and the org pays and stays complimentary | Every Checkout subscription carries `endComplimentary=on_payment`; the sync's existing check (only a grant made before the subscription is ended) keeps later staff grants | Integration |
| B5 | Settings → Plan & billing disables Reconciliation for a complimentary admin with several sources, while `/r/plan` asks which to keep | The loader returns the active sources (`{id, name}[]`, not a count), `/r/plan` reuses it instead of its own query, and Settings uses the same dialog (`keepOneOf`); `disabledReason` and `billingSubscribeTooManySources` go | Loader test returns the list |
| B6 | `staffTotalPaid` returns 0 when billing is off, so the card shows "Total paid $0.00" | Returns `null` (the figure is left out) | Integration |
| B7 | `staffBilling` grew a fourth positional argument | `staffBilling(row, { lastPaid, totalPaidCents }, now)` | Existing tests |
| B8 | `reconciliationStartsOf` is a one-caller wrapper and `UpcomingPlanOrg` a leftover name | Removed and renamed (`QueuedChangeRow`); `limit.ts` calls `reconciliationStartsOn` | Typecheck |
| B9 | Stale comments describe the removed deferred charge | `limit.ts` (`lockedOrgEntitlement`), `sync.ts` (`endsComplimentaryAt`, `writeCopy`'s `paid`), `billing.ts` (`unchangedPhase`), `schema.ts` and `admin/actions.ts` (`complimentary_plan`), the note on `staffBillingFirstCharge`, and the deleted section header in `strings.ts` | Read |
| B11 | `archiveFundingSourceAction` lets an unpaid admin archive, only for the `/r/plan` loop B2 removes | Back behind paid access; its allow-list entry goes; the no-free-use test flips to "refused" | Existing tests |
| B12 | `writeCopy` takes six positional arguments and `startCheckoutAction` two strings | Both take one object (`startCheckoutAction({ plan, interval, keepFundingSourceId })`) | Typecheck |
| B10 | Tests: five use fixed 2027 dates that the new past-date check refuses from 2 January 2027; removing an expired grant is untested (the `enabled &&` mutation survived); the sync ending a grant that has an end date is untested; "pins no free plan" never checks Checkout succeeded; the Detroit-date test sits where every zone agrees; `directory.test.ts` starts with a BOM; the sync test "a deferred plan (trialing, no marker)" describes the removed flow | Relative dates; the missing tests; the assertion; a late-evening case; BOM removed; the stale test deleted and the "(decided 2026-09-25)" label renamed; the Checkout test that expects no marker for a paying org flips (B4) | Each new guard mutation-tested |

**C. Settings → Funding sources** (`app/r/settings/settings-sections.tsx`, `src/modules/funding-sources/actions.ts`)

| # | Finding | Fix |
|---|---|---|
| C1 | "Name on documents" in the details view, "Document display name" in the form; the chip "Organization name" marks the organization's *document* name | "Document display name" everywhere; the chip reads "Same as the organization" |
| C2 | A third pill style (`CHIP`) beside the shared `Badge`; the New funding source card kept the old corners | `Badge`; the add card uses the rows' classes |
| C3 | The greyed Archive on the only active source explains itself only in a hover tooltip; the text is a copy of the server's refusal | Archive is not shown on the only active source; the refusal comes from `UI.fundingSourceKeepOneActive` |
| C4 | "Not set yet: …. Use Edit to add them." reads as unfinished work for optional fields | "Not filled in: …" |

**D. Landing** (`src/modules/landing/*`)

| # | Finding | Fix |
|---|---|---|
| D1 | Phosphor's MIT notice is missing | `PHOSPHOR-LICENSE.txt` beside `landing-icons.tsx` (as `app/fonts/OFL.txt`), pointed to from its header |
| D2 | The 44 px tile's class string is copied 11 times | An `IconTile` helper |
| D3 | 7 older decorative SVGs have no `aria-hidden` | Added |
| D4 | Problem-card titles and tags are in Title Case, against Words rule 6 | Awais's choice (§14.2) |

**E. Docs**: m10's paragraph on `complimentaryStripeStep`; m09 (the paid-plan line, the keep-one dialog in
both places); this file's P21 row, §4.3 table, §4.7 line, §4.8, D2 and the Phase 6 notes; D-129, which
amends D-124 ("nothing is ever archived by a plan change") and D2; data-model's `complimentary_plan`;
a TASKS item for the column; the guard-coverage allow-list reason; §8.5's browser checks for A.

### 14.2 For Awais

| # | Question | Recommendation |
|---|---|---|
| Q1 | Landing problem cards: back to sentence case, or keep Title Case and write the exception into the Words rules? | **Answered 2026-09-28: sentence case** |
| Q2 | Keep one source when the payment goes through (B2), or archive at once and say so plainly in the dialog? | **Answered: when the payment goes through** |
| Q3 | `complimentary_plan` is no longer written by anything. Drop it now, or a TASKS item to drop it before go-live? | **Answered: a TASKS item** |

### 14.3 Order

One commit each, in this order: the plan (this section); A; B; C; D; E. Then a review of the whole
branch (agents), a browser pass, and fixes from the review.

### 14.4 Plan review (2026-09-28)

One reviewer read this plan against the code before anything was built. Changed because of it:
B2's rule was a standing condition and would have archived sources on any later sync (the metadata
stays on the subscription, and syncs run from the webhook, pages, the nightly reconcile and staff
actions): it now runs once, on the sync that first sees the subscription paid. The keep id is
validated at Checkout and scoped by org in the sync, and recorded on Reconciliation only; the
helper is its own file with no revalidation; a kept source already archived is logged, not an
ALERT. B1 gains Cancel plan for the renewing case. B5 passes the list, not a count. B11 (the unpaid
archive exemption, now unused) and B12 (object arguments) were added. A4's reduced-motion code was
cut, since A1 and A2 leave nothing for it to fix. A5 no longer needs a second hook. E gained D-124,
§4.8 and the guard-coverage reason.

---

## Appendix A: Product spec (verbatim)

> Add stripe payments in reconciliation app with the following features:
>
> - Allow users to select any plan that We've listed on the app.
> - Subscribe to those plans on monthly or yearly basis.
> - Cancel plan anytime (access to features will revoke at the end of payment month - not immediately)
> - Create account → Subscribe → Access to all featues in that plan.

Added by the user, 2026-09-25: "we must have something in settings tab about plan we can press the
plus pill"; switching must charge correctly ("i was previously on the other tier and i just press
switch it did and didnt ask me to pay more"), "there is zero margin of error here".

Answers, 2026-09-25: "there is no free way pay to use"; "see the 297 and 497 divide it monthly";
"admins can only handle payment no free trials"; yearly price: "keep it as constants so we can change
the values later on as per our needs"; contracts: "Enforce it in the app"; complimentary end date:
"Yes, enforce it"; upgrade path: "'See plans' link in Plus notes"; "we need to map payment stuff on
landing page accurately aswell"; unpaid records: "just ask them to pay and then they can continue";
demo buttons: "remove them"; price changes: "we will decide that before the app goes live just keep
it changeable".
