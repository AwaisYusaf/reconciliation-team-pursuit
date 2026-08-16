# Adversarial review — screens, actions, auth, spec conformance

Scope: everything the two generation reviews did not cover. Each module implementation was
read against its own spec, then the server actions, auth, upload paths and cross-surface
consistency.

## High

### H1 — the Recurring screen and its own actions disagreed about "already added"

`addedState` takes the recurring item's id and prefers expenses that item actually created,
falling back to matching on name and line item. The **actions** passed the id. The **screen**
did not, and its query never even selected `recurring_item_id` — so the row the user saw and
the action their click ran were answering different questions.

Both directions corrupt a claim:

- A one-click salary expense, later renamed on the expense form to fix a spelling, reverted
  the row to "Add to March". Clicking it created a **second salary line** — duplicated on
  the cover sheet and in the amount billed to the City.
- An expense typed by hand that merely shared a payee made the row read "✓ Added", and
  Remove deleted that hand-entered record.

**Fixed**, and the two halves are now distinguished properly. Display still matches on name
and line item, which is what R8.3 asks for and is genuinely useful — the row is telling the
user this month already has such a record, whoever entered it. *Removal* is held to a
stricter standard: an expense this item did not create is always confirmed first, even with
no documents attached, and the confirmation says plainly that it was not added from here.

Scenario S6 had tested only the name-match display, which is why it passed.

### H2 — retiring a payment source made every historical expense uneditable

`isKnownPaymentSource` required `active = true`, and the edit form only offered active
labels. So after deactivating a source, opening any earlier expense that used it showed a
blank control, and saving failed with "Choose a payment source." The only way forward was to
pick a current label — **overwriting the snapshot that had already printed on a submitted
cover sheet**.

That contradicts R5.1 ("the expense stores the label text as a historical snapshot") and R5.2
("expenses carrying retired labels are still shown and grouped under their stored label").

**Fixed.** A retired label is offered on the record that already carries it, marked
"(retired)", and never on a new expense. Validation only requires a currently-active label
when the value actually changes. Verified end to end: the label appears on the record that
holds it and is absent from the add form.

### H3 — the login limiter could be turned into an account lockout

`clientIp()` returns the literal `"direct"` when `TRUSTED_PROXY_HOPS` is unset, collapsing
both limiters into global buckets. An attacker who knows the email could then exhaust the
per-account budget with wrong passwords and keep the real user locked out indefinitely — at
roughly one request every ninety seconds.

That inverts the design this system deliberately chose: lockout is avoided precisely because
a single shared account per organisation makes it a denial of service against the client.
`TRUSTED_PROXY_HOPS` appeared in no `.env.example` and no deployment doc, so the default
deployment would have run in the degraded mode. `AUTH_SECRET` was undocumented too.

**Fixed** the only way that actually holds: production now refuses to start without it,
exactly as it refuses to store files on local disk without `S3_BUCKET` (D-29). Both variables
are documented in `.env.example` and in the architecture's env list, with the reason.

## Medium

| # | Finding | Disposition |
|---|---|---|
| M1 | `generated_artifacts.line_item_id` cascaded on delete, so deleting a line item destroyed **pinned** artifact rows — the permanent record of what the City received. R10.6 says pinned artifacts are exempt from expiry; D-21 says the org must be able to prove what was submitted. | **Fixed** — `ON DELETE SET NULL`. The record survives the line item. |
| M2 | The Cover Sheets blocking panel listed records without the per-record "Open expense" link R4.4 requires and m04's own design asks for. The packet screen had it. This is where the gap is most often discovered. | **Fixed.** |
| M3 | R10.6 specifies "This month was submitted on **{date}**"; the banner omitted the date, and the page loaded `submittedAt` only to discard it with `Boolean(...)`. | **Fixed** — the date is shown, in the organisation's timezone. |
| M4 | A successful expense save — the most-used action in the app — produced no confirmation at all. m02's specced "Saved — still missing proof of payment." notice did not exist anywhere in the codebase. | **Fixed** — a save confirms, and says so when the record will still be held by the gate, which is the cheapest moment to act on it. |
| M5 | The workbook refused a month with no expenses. That gate is in no spec and no decision: R4.3 is the only download gate defined, an empty month's summary is *not* empty (opening balances, performance grant, reconciliation), and the packet route deliberately allows exactly that month. The m07 screen was displaying figures the user was forbidden to export. | **Fixed** — the extra condition is gone from the route and both buttons. |
| M6 | `precheck` rejected uploads whose browser-declared MIME type was empty, before the magic-byte inspection that the data model names as the authority ever ran. A HEIC from a platform with no OS mapping, or any file without an extension, was refused as an unsupported type. | **Fixed** — an absent type defers to the sniffer; a *wrong* declared type is still refused. |
| M7 | `expenses.recurring_item_id` existed in the schema and was written by the action, but appeared nowhere in the data model. `expense_documents.status = 'pending'` is documented but has been unwritable since D-30. | **Fixed** — both documented. |

## Low

Fixed: the dead, unauthenticated `todayForOrgAction` export removed (a `"use server"` export
is a public endpoint); `isUuid` guards added to the two actions that lacked them, so a
malformed id fails as "not found" rather than as an unhandled Postgres error; the
`delete-blocked` string aligned to R12's verbatim wording, and the two tests that had locked
in the drift; vendor autofill now surfaces an expired session instead of swallowing it.

Recorded, not fixed — all cosmetic or requiring product judgement: settings editors close
before a rejected save resolves, losing what was typed; successful destructive actions give
no confirmation and a failed recurring add still flashes the row green; `SavedTick`, `Field`
and `Eyebrow` were built and never wired; the packet screen's blocking list is ordered by
line item while the route's refusal text is in entry order; the expenses list hides its
payment-source cards entirely on an empty month; login does not delete the caller's previous
session row; `changePasswordAction` has no rate limit, so a stolen cookie gives an unbounded
argon2 oracle; R13.1's org-wide 500 MB storage cap is still unimplemented.

## Confirmed sound

Every `"use server"` export is an async action, authenticates, and scopes every query and
mutation by organisation; cross-tenant ids reach an indistinguishable "no longer exists".
Session tokens are 256-bit with only their hash stored, expiry is exclusive, renewal slides,
logout deletes the row, and password change revokes siblings while keeping the caller. No
route is reachable unauthenticated that should not be. Uploads verify origin, reject on
declared length before reading the body, sniff magic bytes, refuse encrypted and zero-page
PDFs, and build keys server-side. And R10.2 holds: every surface reads through the shared
domain services, with the R4.4 wording produced in exactly one place.
