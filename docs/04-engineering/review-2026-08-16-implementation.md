# Adversarial Implementation Review — 2026-08-16

Three independent fresh-context reviewers audited the **code** (the earlier
`review-2026-08-16.md` audited the documentation): security/tenancy, correctness against
the specification, and React 19 / Next 16 runtime behaviour. Findings below are recorded
with their disposition. All three converged independently on several defects, which is the
strongest signal in the set.

Browser testing found one blocker that no unit test or `curl` check could: `curl` does not
follow redirects by default, so an infinite redirect loop was invisible until a real
browser hit it.

## Fixed in this pass

| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | Blocker | **Infinite redirect loop locking users out.** `proxy.ts` bounced any holder of a session cookie away from `/login`, but it can only see that a cookie exists, not that it is valid. A user whose session was revoked or expired looped `/login → / → /login` forever and could never sign in again. | The proxy no longer makes a decision it lacks the information to make; the auth pages perform the real check. Regression tests in `src/services/auth/proxy.test.ts`. |
| 2 | Blocker | **Cross-tenant line-item rebind.** `updateExpenseAction` never verified that the submitted `lineItemId` belonged to the caller's organisation (create did), so an expense could be bound to another organisation's line item, whose name then rendered on this organisation's screens. | Ownership check added, matching the create path. |
| 3 | Blocker | **Login rate limiting bypassable.** `clientIp()` took the leftmost, entirely client-controlled `X-Forwarded-For` entry, so varying the header minted a fresh bucket per request — defeating the only brute-force bound (lockout is deliberately absent). | IP derived from a configured `TRUSTED_PROXY_HOPS` count from the right; the header is ignored when no proxy is configured. |
| 4 | Blocker | **R4.2 unenforced.** Nothing stopped an expense being both marked "No receipt available" and carrying a receipt — not on create, not in ingestion, and not in the client, which uploaded queued receipt files *after* the save that had just cleared them. The cover sheet would then print "No receipt available" for an expense whose receipt is in the packet. | Enforced in the ingestion service (the only path that creates receipt rows), and the client drops queued receipt files when the box is ticked. |
| 5 | Blocker | **No error boundaries.** Any server action that threw rather than returning a typed failure replaced the whole page with the framework's bare error screen, with no way back. An unguarded `json()` parse on a non-JSON 500 did the same to the half-filled expense form. | `app/(app)/error.tsx`, `app/(app)/not-found.tsx`, `app/not-found.tsx`; upload fetch and the upload route both guarded so failures stay typed. |
| 6 | Major | Onboarding actions had no `onboarded` guard, so a replayed call could wipe a live organisation's approved budget. | Both actions return early once onboarding is complete. |
| 7 | Major | Local storage traversal guard used `startsWith` without a separator, accepting sibling directories sharing the prefix. | Compares against `root + path.sep`. |
| 8 | Major | Upload route buffered the whole body before any size check; Next's body limit covers Server Actions only. | `Content-Length` rejected before parsing. |
| 9 | Major | Malformed ids reached `uuid` columns, raising a Postgres 22P02 as an unhandled 500 instead of the intended "not found". | `src/lib/ids.ts` guard applied across actions and the download route. |
| 10 | Major | Month key unvalidated on month-document upload, reaching the object key. | Validated in the route. |
| 11 | Major | Thumbnail fallback served PDF bytes labelled `image/jpeg`, so every PDF attachment rendered as a broken image. | Honest 404 for a missing thumbnail, plus `X-Content-Type-Options: nosniff`. |
| 12 | Major | Edit-mode projection restored the saved amount even after the line item changed, overstating remaining budget. | Restored only when the line item is unchanged. |
| 13 | Major | Header could show one month while the pages below rendered another, once the active month fell outside the rolling window. | The persisted active month is always in the window. |
| 14 | Major | Payment-source cards ignored the `active` flag, so deactivated labels kept appearing. | Filtered to active. |
| 15 | Major | A failed upload discarded the untried remainder of the queue silently. | The surviving queue is preserved and reported. |
| 16 | Major | Suggestions popped open unrequested on the edit page and could overwrite a typed description. | Skipped for the loaded name; never overwrites user text. |
| 17 | — | **Schema naming inconsistency** found while writing a cleanup query: 27 `createdAt`/`updatedAt` columns were camelCase beside otherwise snake_case columns, because the timestamp helpers omitted explicit names — every hand-written query had to quote them. | Helpers name their columns; initial migration regenerated (nothing is deployed, and all local data is reproducible from seed). |

## Recorded, not yet fixed

Deferred deliberately, with the reasoning:

- **Unbuilt routes 404** — `/cover-sheets`, `/packet`, `/contract-summary`, `/settings` are
  four of the nine nav tabs. They are the modules still to be built (m04, m06, m07, m09);
  the shell-preserving `not-found.tsx` now keeps navigation available. Gating the tabs
  would be undone as each module lands.
- **`paymentSource` / `supportingType` not validated against the organisation's configured
  lists** — a client can post an arbitrary label. Worth fixing before the generators land,
  since these strings print on submitted documents (and a leading `=` would be spreadsheet
  formula injection in the Excel export).
- **Recurring "Remove" targets by name match**, so it can delete a manually entered expense
  for the same payee and line item. Needs an originating `recurring_item_id` column.
- **`sortOrder` not reassigned when an expense moves month**, so it can collide with the
  destination month's ordering.
- **`sortOrder` max+1 races** under concurrent creates; **`learnVendor` race** discards the
  newer defaults.
- **Org-wide 500 MB storage cap (R13.1)** is unimplemented; per-file, per-expense and
  per-month caps are in place.
- **Session sweep and `revokeOtherSessions` have no callers** — they belong to the cron job
  and to m09's password change.
- **`documentsFor` scans all of an organisation's documents** and filters in JavaScript.
- **Login copy reveals whether an account exists** — this is accepted risk D-25, not a new
  defect, but the timing difference (argon2 skipped for unknown emails) is worth closing.
- Assorted minors: expense fields are not inside a `<form>` (Enter does not submit),
  discarded `ActionResult`s on document removal, the recurring highlight never clears,
  uncleared autofill timers, `centsToDollars` duplicated at four call sites.

## Browser testing performed

Signed in through the real UI and exercised, with screenshots and DOM assertions:
sign-in; the dashboard (all six rows, exactly two low-budget cells, Analytical Support at
10.52 % correctly unflagged); the expense form's vendor autofill (line item and description
filled from the library, highlight applied); live reimbursable math ($93.00 + $2.50 fees =
$95.50 with $5.00 tax excluded) and the projection ($7,038.31 − $95.50 = $6,942.81); the
no-receipt toggle revealing its required reason and hiding the receipt upload; queueing a
real PNG, saving, and confirming the expense plus its inspected, stored, `attached` proof;
sign-up validation and both onboarding steps (earlier pass); month selector persistence;
log out.
