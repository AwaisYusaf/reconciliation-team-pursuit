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
| S3 | Add the cron entry for it | `deploy-ec2.md` § Backups |
| S4 | Apply the S3 lifecycle rules (30 daily, 13 months monthly) | `deploy-ec2.md` § Backups → Retention |
| S5 | **Execute the restore drill once.** This is what actually closes D-07 — the procedure is proven on a dev database, not yet on the instance | `deploy-ec2.md` § Backups → The drill |

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
| R6 | **R13.1's org-wide 500 MB storage cap is unimplemented** | Declared in the domain rules and not enforced anywhere | board review |

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
