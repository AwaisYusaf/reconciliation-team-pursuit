# Authentication hardening review

Scope: the session and authentication subsystem only — tokens, session store, password
handling, the auth actions, rate limiting, `proxy.ts`, the auth pages, and the environment
these depend on.

The threat model shapes every judgement below: **one shared organisation account** used by
two or three staff, with no self-serve password reset (D-24) and no session-list UI. Locking
that account out is a denial of service against the client, which is why there is
deliberately no lockout — and why anything that can exhaust the single container is treated
as severe.

## High

### H1 — an unauthenticated request could exhaust the container's memory

`consume()` builds its bucket key from caller-supplied values. For login that key contains
the submitted email, which arrives from the form with no length or format check — only
`signUpAction` used zod. Buckets were only ever removed by `sweep()`, and **`sweep()` had no
production caller at all**: no timer, no instrumentation, nothing.

Measured directly: **900 buckets carrying a 900 KB "email" retained 772 MB**, and an explicit
sweep released all of it. The per-IP limit caps an attacker at 30 requests per 15 minutes —
two per minute, under any alerting threshold — and each allowed request mints one permanent
entry. That extrapolates to roughly 2.5 GB a day from a single IP against an endpoint that
requires no credentials.

The consequence is an OOM of the container that also hosts Postgres: the application is
unreachable for every member of staff. That is precisely the outage the no-lockout design
exists to prevent, reached by a different route — and worst on a submission deadline.

**Fixed, both halves.** Keys are truncated to 320 characters (RFC 5321 caps a forward path at
256, so no legal address is affected), and `consume` sweeps expired buckets itself — at most
once a minute, or immediately once the map passes 5,000 entries. Sweeping there rather than
on a timer means nothing has to be started at boot and a warm process behaves like a cold
one. Login additionally rejects an implausible email before it can reach a key. Five tests
cover the bound.

### H2 — an unvalidated proxy header made both login budgets unreachable

`clientIp()` fell back to `X-Real-IP` and used it verbatim. The correctly-configured path is
sound — the reviewer probed appending-proxy semantics and forged prefixes all resolve to the
true client — but the fallback is reachable when the app port is hit without traversing the
proxy, or when `TRUSTED_PROXY_HOPS` exceeds what the proxy actually produces.

Either way, sending a fresh nonce per request lands every attempt in a virgin bucket, so
neither the per-IP nor the per-account budget ever fires: unbounded password guessing against
the one shared account, behind which there is deliberately no lockout.

**Fixed.** Both the `X-Forwarded-For` entry and the `X-Real-IP` fallback must now look like
an address before they are trusted as an identity.

## Medium

| # | Finding | Disposition |
|---|---|---|
| M1 | **`AUTH_SECRET` was a phantom control.** `.env.example` said it signed session material; nothing in the codebase read it. An operator rotating it after a suspected cookie compromise would restart, believe every session was dead, and be wrong — with no session-list UI to correct them. Documenting it (a previous "fix") had made this worse, not better. | **Fixed by wiring it.** Session tokens are now stored as an HMAC keyed by `AUTH_SECRET`, so rotation genuinely revokes everything — the only "sign everybody out" lever this system has (D-46). |
| M2 | `.env.example` shipped `SIGNUP_ENABLED="true"` while the architecture and D-15 say default false. That file is what operators copy, so the documented-safe default was the opposite of the shipped one — on an internet-facing system holding City grant records. | **Fixed** — ships closed, with a comment saying to open it only for the one-time provisioning. |
| M3 | `signUpAction` had no rate limit and no session check. Every attempt reached argon2 on the same libuv threadpool login's verification uses, so an unauthenticated flood starved sign-in for the staff. | **Fixed** — budgeted at 5/hour per address, and a signed-in caller is refused rather than silently swapped onto a new empty organisation. |
| M4 | No absolute session lifetime. The sliding window renews indefinitely, so a stolen cookie touched monthly stayed valid forever. | **Fixed** — a 90-day cap from `created_at`, enforced in `resolveSession` (D-47). |
| M5 | The operator reset runbook described a script that did not exist. Under D-24 this is the *only* recovery path; an operator improvising `UPDATE users SET password_hash = …` leaves the attacker's session row untouched, so the "reset" achieves nothing. | **Fixed** — `npm run db:reset-password` sets the hash **and** deletes every session for that user. Verified: two live sessions, both revoked, new password verifies. |
| M6 | The `generate` limit was declared in the architecture and never enforced anywhere. One authenticated tab could queue unbounded ten-minute packet builds. | **Fixed** — enforced on all three download routes. Verified: six succeed, the seventh returns 429 with `Retry-After`. |
| M7 | "Refuses to start in production" was a lazy throw at first use, for both `TRUSTED_PROXY_HOPS` and `S3_BUCKET`. A misconfigured deploy booted, served the login page, and failed with an error boundary when somebody tried to sign in. | **Fixed** — `instrumentation.ts` checks them at startup, which is the only place that claim can be true (D-49). It also rejects an implausible hop count, since a wrong one is worse than none. |

## Low — fixed

The `__Host-` cookie prefix is adopted in production (the cookie already met every
precondition, so it is free hardening against subdomain shadowing); `tokenHashesEqual` was
dead code that looked load-bearing and is gone; the `Sec-Fetch-Site` fail-open is now
commented as deliberate; and `db:seed` refuses to run in production without `SEED_PASSWORD`,
which previously defaulted to a string committed to this repository and printed to stdout.

## Low — recorded, not fixed

Fixed-window limiting allows 2× the limit across a boundary (inherent to the algorithm; note
it if 30/15min is ever relied on precisely). A successful login clears the whole per-IP
budget rather than just that account's, which on a NAT'd office IP refills a co-located
attacker's budget — minor with one organisation, since a successful login means they already
have the credential. The caller's own token is not rotated on password change (not fixation,
but rotating is the cheap norm). There is no maximum password length and no rehash-on-login
when argon2 parameters change.

## Examined and sound

Token generation is `randomBytes(32)` → base64url, 256 bits from a CSPRNG, and the plaintext
is written nowhere but the cookie. `startSession` always mints a fresh token and never adopts
a client-supplied one, on both sign-in and sign-up. Cookie attributes are correct, with
`secure` conditional on environment in a way that fails closed. Sessions cannot outlive their
user or organisation — cascading foreign keys plus inner joins, defence in depth. The argon2
parameters match current OWASP guidance, and `verify()` honours the parameters embedded in
the stored hash, so raising them later will not lock the account out. CSRF is covered by
Next's same-origin Server Action check plus an equivalent explicit check on the upload route.
`proxy.ts` is genuinely not a security boundary — every page and route authenticates itself.
There is no open redirect. The signup duplicate-organisation race is closed by a `lower(email)`
unique index inside the same transaction. Onboarding re-checks server-side and cannot be
replayed against another organisation.

Login copy does distinguish unknown-email from wrong-password, which is **recorded and
accepted as D-25** while signup is gated. One note for phase 2: the unknown-email path
returns before `verifyPassword`, so equalising the copy alone would leave a clean timing
oracle — both halves have to change together.
