# m00 — App Shell & Auth

## Purpose
Everything outside the eight feature screens: sign in, sign up, onboarding, and the authenticated chrome (header, month selector, nav, log out) every other module renders inside.

## Scope
- Routes: `/login`, `/signup`, `/onboarding/line-items`, `/onboarding/contract`, authenticated layout wrapping all app routes.
- Session: email + password → custom DB-backed session (architecture §Auth, D-06: cookie token hashed at rest, 30-day sliding TTL, password change invalidates other sessions). No demo credentials anywhere in UI. Login throttled per email+IP (10 attempts / 15 min).
- Sign-up (`SIGNUP_ENABLED`, default false → login-page link hidden and `/signup` renders "Sign-ups are closed.") creates org + user; `organizations.onboarded_at` is null until onboarding completes — login redirects into onboarding while null, straight to Dashboard after.
- Onboarding steps hold client state; one `completeOnboarding` transaction at step 2 (Finish **and** Skip both run it — contract_settings row always created, zero/null defaults). Sets `onboarded_at`, seeds payment sources + supporting doc types (D-19), initializes `active_month` to the current month (America/Detroit, R2.5).
- Month selector: months from 12 before to 3 after the current month, plus any month containing data, plus an `Earlier month…` option opening a free month picker (back-entry, D-14). Persists selection (`organizations.active_month`); changing it re-scopes every screen.
- First-run affordances: welcome banner on Dashboard until dismissed (`welcome_dismissed_at`) — "Your budget is set up. Add your first expense to get started." + Add Expense / Dismiss.
- Login page carries the R12 line: `Forgot your password? Contact Mantaq.` (no self-serve reset — operator runbook, D-26).

## Data
Reads/writes `organizations`, `users`, `contract_settings`, `line_items` (onboarding creates them). Rules: R2.3 (month persistence), R9.1 (line item creation).

## Behavior notes
- Login errors (exact): unknown email → `We couldn't find an organisation with that email. Create an account to get started.` · wrong password → `That password doesn't match this organisation email.` · empty → `Enter your organisation email and password.`
- Signup validation: org name required; valid email; password ≥ 12 chars; confirm matches; email unique (duplicate → R12 `duplicate-email` string). Show/Hide password toggle.
- Onboarding step 1 "Set up your budget line items": editable rows (name + budget), starter **names** prefilled with budgets empty (Salary, Analytical Support, Promotional & Marketing, Social Services & Support, Community Programs & Events, Professional Development), add/remove rows, running `Total budget:` line, Continue disabled until one valid row.
- Onboarding step 2 "Your contract": total contract value, start/end dates, fiduciary name — all optional; `Finish setup` / `Skip for now` both land on Dashboard with banner. (Full contract detail lives in Settings, m09.)

## Server surface
`signIn` (rate-limited), `signOut`, `signUp`, `completeOnboarding` (creates line items + contract settings + seeded lists transactionally, sets onboarded_at), `setActiveMonth`, `dismissWelcomeBanner`.

## Acceptance
Sign-up → onboarding → empty dashboard flow works; abandoning mid-onboarding and logging back in resumes onboarding; refresh restores session + active month; all app routes redirect unauthenticated users to `/login`; passwords hashed (argon2id, min 12); login throttle engages; no route leaks another org's data (two-org IDOR suite passes).

---

## Claude Design prompt

```
Design the authentication and onboarding flow for "Grant Expense Reconciliation" (4 screens +
the app chrome demo).

1) SIGN IN — centered card (max 440px) on the paper background: small serif line "Grant
Expense Reconciliation", h1 "Sign in to your organisation", fields "Organisation email"
(placeholder you@yourorganisation.org) and "Password", full-width primary button "Sign in",
inline error state example in red ("That password doesn't match this organisation email."),
a quiet centered line "Forgot your password? Contact Mantaq.", and footer line "Don't have an
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
