# m00 — App Shell & Auth

## Purpose
Everything outside the eight feature screens: sign in, sign up, onboarding, and the authenticated chrome (header, month selector, funding source selector, nav, log out) every other module renders inside.

## Scope
- Routes: `/login`, `/signup`, `/onboarding/line-items`, `/onboarding/contract` (stay unprefixed — outside the `/r` group), authenticated layout wrapping all app routes at `/r`. `/privacy` and `/terms` are public (no sign-in, `proxy.ts` `PUBLIC_PATHS`), linked from the landing footer and from sign-up, where a line under Create account says the account agrees to them (D-130).
- Session: email + password → custom DB-backed session (architecture §Auth, D-06: cookie token hashed at rest, 30-day sliding TTL, password change invalidates other sessions). No demo credentials anywhere in UI. Login throttled per email+IP (10 attempts / 15 min).
- Sign-up (`SIGNUP_ENABLED`, default false → login-page link hidden and `/signup` renders "Sign-ups are closed.") creates org + user; `organizations.onboarded_at` is null until onboarding completes — login redirects into onboarding while null, straight to Dashboard after.
- Onboarding step 1 **persists line items immediately** (rather than holding them in client state) so a refresh or an abandoned signup never loses the typed budget; `onboarded_at` stays null until step 2, which is what makes the flow resumable. Step 2 (Finish **and** Skip both) writes the contract details onto the organisation's first funding source (created at sign-up; D-93 — `contract_settings` is deprecated and no longer written), seeds payment sources + supporting doc types (D-19), and sets `onboarded_at`. `active_month` is initialised to the current month (America/Detroit, R2.5) at signup.
- Month selector: the union of **the contract's own months** (`contract_start`…`contract_end`, inclusive, capped at 120), the rolling window from 12 months before to 3 after the current month, any month containing data, and the persisted active month — newest first, grouped by year with `<optgroup>`. Plus an `Other month…` option opening a free month picker for anything outside that union (back-entry before the contract, or past its end — D-14/D-30). The contract months are what make a multi-year contract fully selectable without an administrator adding months by hand, and what make the list extend itself when the end date is edited on renewal; the rolling window is the floor for organisations that never entered contract dates. Persists selection per person (`users.active_month`, Phase 18); changing it re-scopes every screen for that person only. With **All** funding sources selected, this is the union of every source's own contract months and expense months — archived sources included, since their history stays viewable (§14 open question 5).
- Funding source selector (Phase 6, D-93, R14.2): renders next to the month selector, **only when the organisation has more than one funding source** — a single-source organisation never sees it and every screen behaves exactly as before this feature shipped. Options: "All funding sources", then each active source. Archived sources are not listed (R14.3); the only exception is an archived source that is already the stored selection, shown so the control never goes blank. Persists selection per person (`users.active_funding_source_id`, Phase 18; `setActiveFundingSourceAction`, same persist-then-refresh pattern as the month selector) and re-scopes every screen the way the month does.
- First-run affordances: welcome banner on Dashboard until that person dismisses it (`users.welcome_dismissed_at`, per person since Phase 18) — "Your budget is set up. Add your first expense to get started." + Add Expense / Dismiss.
- Guided tours (Phase 7, D-94; expanded D-95): nine short, skippable, once-only walkthroughs, one per tab. Skip (or Escape) on any of them marks all nine seen for that person, so no other tab's tour appears later; Finish marks only its own (D-132) — Dashboard (4 steps), Add Expense (6, new-expense route only), Expenses (3), Cover Sheets (3), Recurring (2, with a fallback target when every item is already added to the month), Month-End Packet (5, gated on a single source resolved — not while "All funding sources" is selected), Contract Summary (2), Line Items (3), Settings (7, one per section). Each starts automatically the first time that user opens the tab and never reappears once Skipped or Finished, on any device — keyed per user (`user_tour_progress`), not per browser, unlike the welcome banner above. A step's `autoOpen` (D-95) clicks another element first — a Settings sidebar tab, Line Items' "Manage" modal, an Expenses row's ⋮ menu — so the tour puts the page into the state it's describing instead of only pointing at a closed control; `OverlayShell`'s own focus-containment exempts the tour's own portal (`data-tour-overlay`) so a Modal opened this way can't lock its Skip/Back/Done out. The very first tour a user ever sees (always Dashboard) chains automatically into every other tour in nav order via `router.push` on Finish (not Skip) — `TOUR_SEQUENCE` in `src/modules/tours/sequence.ts` — so a brand-new user is carried through all nine without having to click into each tab themselves; each `push` is paired with a `router.refresh()` since the client Router Cache can otherwise serve a stale `alreadySeen` for the next tab. "Show the app guide again" in Settings (Account section) deletes that user's rows, re-arming all nine; the header's (i) button next to Sign out (`tour-replay-button.tsx`) replays just the current screen's tour.
- Login page carries the R12 line: `Forgot your password? Email tech@authenticbusiness.io` (no self-serve reset — operator runbook, D-24/D-26).
- **AB Solutions staff use this same login page** (Phase 9, D-98). `signInAction` looks in `users` first and falls back to `staff_users`; an unknown address gets the same wording either way, so the form cannot be used to tell staff addresses from customer ones. A staff sign-in starts a `staff_sessions` row and redirects to `/a` (m10), never to `/r` or onboarding. `/login` and `/signup` both redirect an existing staff session to `/a`. There is no staff sign-up — accounts come from `npm run db:create-staff` (architecture §Auth).
- **Suspended organisation** (Phase 9, D-99): once `organizations.suspended_at` is set, `resolveSession` stops resolving that org's sessions, so a page the user already had open stops working on their next click and lands them back on `/login`. Signing in there with the **correct** password shows `Your organization's access is paused. Please contact support.` and creates no session; a **wrong** password gets the normal wrong-password message, so the form cannot be used to learn whether an organisation is suspended.

## Data
Reads/writes `organizations`, `users`, `funding_sources`, `line_items` (onboarding creates the first funding source and its line items), `user_tour_progress` (D-94). Reads `staff_users` and writes `staff_sessions` on a staff sign-in, and writes `users.last_sign_in_at` on a customer one (Phase 9). Rules: R2.3 (month persistence), R9.1 (line item creation), §14 (funding source selection and isolation).

## Behavior notes
- Login errors (exact): unknown email → `We couldn't find an account with that email. Check the address and try again.` · wrong password → `That password doesn't match this email.` · empty → `Enter your email and password.` · suspended organisation, correct password → `Your organization's access is paused. Please contact support.` (§12, American spelling since the Phase 9 sweep)
- Signup validation: org name required; valid email; password ≥ 12 chars; confirm matches; email unique (duplicate → R12 `duplicate-email` string). Show/Hide password toggle.
- Onboarding step 1 "Set up your budget line items": editable rows (name + budget), starter **names** prefilled with budgets empty (Salary, Analytical Support, Promotional & Marketing, Social Services & Support, Community Programs & Events, Professional Development), add/remove rows, running `Total budget:` line, Continue disabled until one valid row.
- Onboarding step 2 "Your contract": total contract value, start/end dates, fiduciary name — all optional; `Finish setup` / `Skip for now` both land on Dashboard with banner. (Full contract detail lives in Settings, m09.)

## Server surface
`signIn` (rate-limited), `signOut`, `signUp` (also creates the organisation's first funding source), `completeOnboarding` (writes the first funding source's contract details + seeded lists transactionally, sets onboarded_at; the line items were saved by step 1 on that same source), `setActiveMonth`, `setActiveFundingSource`, `dismissWelcomeBanner`, `completeTourAction` (D-94, marks one tour seen for the current user), `resetToursAction` ("Show the app guide again" — clears all of the current user's tour rows), `replayTourAction` (D-95, the header (i) button — clears just one tour's row).

## Acceptance
Sign-up → onboarding → empty dashboard flow works; abandoning mid-onboarding and logging back in resumes onboarding; refresh restores session + active month; all app routes redirect unauthenticated users to `/login`; passwords hashed (argon2id, min 12); login throttle engages; no route leaks another org's data (two-org IDOR suite passes). A staff sign-in lands on `/a` and cannot reach `/r` or the file routes; a customer of any role cannot reach `/a`; a suspended organisation's user is signed out at once and sees the paused message on the next sign-in, and everything is exactly as they left it after a reinstatement.

---

## Claude Design prompt

```
Design the authentication and onboarding flow for "Stay Funded 360" (4 screens +
the app chrome demo).

1) SIGN IN — centered card (max 440px) on the paper background: small serif line "Stay
Funded 360", h1 "Sign in to your organisation", fields "Email"
(placeholder you@yourorganization.org) and "Password", full-width primary button "Sign in",
inline error state example in red ("That password doesn't match this email."),
a quiet centered line "Forgot your password? Email {support address}.", and footer line "Don't have an
account? Create an account" (link).

2) CREATE ACCOUNT — same card style: h1 "Create your organisation", fields Organisation name,
Email, Password (placeholder "At least 12 characters", with Show/Hide toggle button), Confirm
password, primary "Create account", link back "Already have an account? Sign in". Show one
field-level validation error example.

3) ONBOARDING STEP 1 OF 2 — wider card (max 720px): eyebrow "STEP 1 OF 2", h1 "Set up your
budget line items", helper "These are the categories your funder approved. You can change them
later." Editable table: Line Item (text input) | Budget (money input) | Remove link. Six rows
with names prefilled and budgets shown as the user has typed them: Salary $458,692.46,
Analytical Support $66,929.14, Promotional & Marketing $58,212.62, Social Services & Support
$41,250.00, Community Programs & Events $39,832.45, Professional Development $15,000.00.
"Add line item" secondary button, bold "Total budget: $679,916.67", full-width primary
"Continue".

4) ONBOARDING STEP 2 OF 2 — eyebrow "STEP 2 OF 2", h1 "Your contract", helper "This appears
on the summary sheet you send for review." Fields: Total contract value (optional), Contract
start date / end date (optional, side by side), Fiduciary or reviewing organisation name
(optional, placeholder "e.g. Detroit Crime Commission"). Buttons: primary "Finish setup" +
quiet underlined "Skip for now".

5) APP CHROME DEMO — show the authenticated shell exactly as described in the design system
(org name "Team Pursuit Global", month select showing "February 2026", the 9 nav tabs with
Dashboard active) wrapping an empty content area that shows the first-run banner: "Your budget
is set up. Add your first expense to get started." with primary "Add Expense" and quiet
"Dismiss", plus a dashed empty-state box "No expenses recorded for February 2026 yet."
```
