# Outstanding work

Everything known to be unfinished, in the order I would take it. Each item says why it
matters and where it is recorded, so nothing here needs re-deriving from the code.

Last reviewed: 2026-08-20. The application is deployed and serving at
`reconciliation.teampursuit.org`.

---

## 1. Blocked on the client — nothing to build

| # | Item | Why it blocks | Ref |
|---|---|---|---|
| C1 | **Real contract figures from Misty** — line-item scheduled values, opening previously-billed, perf grant billed-to-date, advances received, PO/contract numbers | **Production is generating documents from February placeholders.** Every figure on every cover sheet, workbook and packet derives from these, so today's output is structurally right and numerically wrong. Also blocks the numeric half of the February test | D-13 |
| C2 | **Go-live month**, and whether prior months get back-entered | Decides whether the "Earlier month…" path needs exercising before launch | D-14 |

---

## 2. Needs a person on the server — code is written and pushed

| # | Item | Command / where |
|---|---|---|
| S1 | Deploy the latest changes | `cd ~/ngo-expenses && git pull && ./deploy.sh` |
| S2 | Run the nightly backup once by hand and read the output | `./backup.sh` |
| S3 | **Before deploying multiple funding sources (Phase 6, D-93):** take a fresh backup, then run the read-only preflight and read it — exit code 2 with a `BLOCKER` line means do not deploy | `./backup.sh`, then `docker compose -f docker-compose.prod.yml run --rm migrate npm run db:preflight-funding-sources` (or any container with the app and `DATABASE_URL`) — see `docs/PHASE-6.md` Results |
| S3 | Add the cron entry for it | `deploy-ec2.md` § Backups |
| S4 | Apply the S3 lifecycle rules (30 daily, 13 months monthly) | `deploy-ec2.md` § Backups → Retention |
| S5 | **Execute the restore drill once.** This is what actually closes D-07 — the procedure is proven on a dev database, not yet on the instance | `deploy-ec2.md` § Backups → The drill |
| S6 | **After deploying Phase 9 (the AB Solutions staff dashboard), create one staff account per AB Solutions staff member.** There is no staff sign-up, so until this is run nobody can open `/a` at all. Run it once each, after `deploy.sh` has applied migration `0027` | `docker compose -f docker-compose.prod.yml exec app npm run db:create-staff -- --email <address> --name "<Full Name>"` — see `deploy-ec2.md` § Operational notes. The password is printed once; hand it over out of band |

Until S2–S5 are done there is still no working backup regime, only the machinery for one.

---

## 3. Correctness and robustness

| # | Item | Why | Ref |
|---|---|---|---|
| R1 | **Single-flight lock per (org, month, type)** | Two clicks on Download Packet run two full builds. Outputs are deterministic so the result is correct either way; the cost is duplicated CPU and memory on a container that also hosts Postgres | outputs review |
| R2 | **`MAX_PACKET_BYTES` and `RASTER_LADDER` are not in the artifact cache key** | Changing either without bumping `GENERATOR_VERSION` serves old-quality bytes forever, because pinned rows are never replaced. A trap for whoever tunes quality next | outputs review |
| R3 | **Wall-clock bound on a whole build** | Only per-child timeouts exist. `maxDuration` is platform metadata that `next start` does not enforce, so a wedged build has no ceiling | outputs review |
| R4 | **Packet memory is ~3× the output** | pdf-lib holds every embedded image until `save()`. Bounding it means streaming assembly or a page cap. Matters on a 3.7 GB box shared with another service | outputs review |
| R5 | **The size ladder rebuilds the whole packet per step** | Re-runs LibreOffice once per line item on each retry — up to 3× the whole build for an oversize month | outputs review |
| ~~R6~~ | ~~**R13.1's org-wide storage cap is unimplemented**~~ **Done.** `MAX_ORG_BYTES` (5 GB, not the 500 MB this line quoted) is enforced in `orgStorageError` inside the upload lock, and since Phase 9 the same `orgStorageBytes()` feeds the staff dashboard's storage bar, so the number shown is the number enforced. Verified live against Team Pursuit Global | `services/storage/documents.ts`, D-100 Q1 |

---

## 4. Testing

| # | Item | Why |
|---|---|---|
| T1 | **Deploy-time render smoke test** | Two bugs this month were invisible locally and only real in the container: LibreOffice 7.4 crushing every proof image, and the 10 pt/11 pt divergence. Converting one cover sheet inside the real image during deploy would catch that whole class cheaply |
| T2 | **DB integration tests silently skip on every dev machine** | vitest does not load `.env.local`, so `DATABASE_URL` is unset and every integration test skips. The suite is green while the database layer is untested — which is how the eager-connect bug reached production |
| T3 | **No end-to-end tests** | 418 unit tests, zero Playwright. No test drives a real browser through sign-in → add expense → download packet |
| T4 | **Visual half of the February test** | Blocked on C1. Note the approved packet is rasterized — no extractable text on 131 of 133 pages — so this can only ever be a visual page-by-page comparison, never an automated text diff |

---

## 5. Security — recorded and accepted, not fixed

None of these is a live hole; each is a sharp edge worth filing down before the system carries
a year of real records.

| # | Item | Ref |
|---|---|---|
| P1 | `changePasswordAction` has no rate limit, so a stolen cookie gives an unbounded argon2 oracle | board review |
| P2 | Login does not delete the caller's previous session row | board review |
| P3 | Signup is now open with no email verification — your call, but it means anyone who finds the URL can create an organisation | D-15 |
| P4 | Login copy distinguishes unknown-email from wrong-password. Equalising it alone would leave a timing oracle, since the unknown-email path returns before `verifyPassword` — both halves must change together | D-25, auth review |
| P5 | No token rotation on password change; no maximum password length; no rehash-on-login when argon2 parameters change | auth review |
| P6 | **Phase 9: a paused sign-in does not reset the rate-limit buckets**, so a suspended organisation's own users can exhaust their login budget while support is on the phone. Deliberate — resetting on a refused sign-in weakens the limiter | PHASE-9 Phase 2 |
| P7 | **Phase 9: `createOrgUserAction` answers "email in use" for an AB Solutions staff address too**, so an org admin can probe whether an address belongs to staff. The cross-table check is what the spec asks for, and the action is admin-only and rate-limited | PHASE-9 §3.3 |
| P8 | **Phase 9: nothing spans `users` and `staff_users`**, so a customer signup and a `db:create-staff` run for the same address at the same instant can both pass `emailInUse()`. Needs an operator script racing a live signup | `modules/auth/emails.ts` `ponytail:` note |
| P9 | **Phase 9: `withLockedOrg` returns a `fail()` from inside `db.transaction`, which commits rather than rolls back.** Correct today because every refusal in the four admin actions happens before any write — fragile if a future edit writes first | PHASE-9 Phase 2 |

---

## 6. UI polish — cosmetic or needing product judgement

| # | Item |
|---|---|
| U1 | Settings editors close before a rejected save resolves, losing what was typed |
| U2 | Successful destructive actions give no confirmation; a failed recurring add still flashes the row green |
| U3 | `SavedTick` and `Field` were built and never wired (`Eyebrow` now is, on the onboarding pages) |
| U4 | The packet screen's blocking list is ordered by line item while the route's refusal text is in entry order |
| U5 | The expenses list hides its payment-source cards entirely on an empty month |
| U6 | `text-muted` and `bg-surface-2` appear in 19 places but neither colour is defined in `globals.css`, so those styles silently do nothing. The count has grown as new screens copied the pattern, which is the argument for fixing it rather than leaving it |

---

## Recently landed

For context on what no longer needs doing: EC2 deployment with `deploy.sh` · nightly backup
with a proven restore · full-screen receipt viewer · vendor library remembering payment source
and amounts · the LibreOffice image-crush fix · cover sheets at 10 pt · workbook currency
pinned to en-US · signup enabled.

From PRs #1 and #2, merged separately: the vendor library split into a Settings preview and a
full searchable, paginated screen at `/settings/vendors` · the month-documents file input
styled as a real button · the login page's forgot-password text made a real link · unusual
expense amounts (tax above subtotal, a zero subtotal) now warn rather than block. Suite is at
446 tests.

**Phase 9 — the AB Solutions staff dashboard** (`docs/PHASE-9.md`, D-98 to D-101), built and
verified, **not yet deployed**: staff accounts in their own `staff_users`/`staff_sessions`
tables with a shared login form and the `/a` gate that finally keeps an organisation's own
admin out; suspension enforced in `resolveSession` with the paused sign-in message;
plan · status · complimentary access, each with a `org_account_events` history line carrying
who, when and why; the organizations directory with summary cards, search and filters; and the
per-organisation account/usage page. Every "Done when" line in the ticket was walked in a real
browser at 1280 and 768 against an organisation with real data — see PHASE-9 § Results —
Phase 5. Suite is at 1078 tests. Deploy step S6 above is required with this release.
