# Decision Log

## Settled

| # | Date | Decision | Why |
|---|---|---|---|
| D-01 | 2026-08-13 | SOW signed: MVP scope, $2,000, 7–10 working days, Mantaq infra | Contract |
| D-02 | 2026-08-15 | Prototype approved by client; screens beyond SOW's 7 (Contract Summary, auth/signup/onboarding) are in scope | Client discussion after SOW |
| D-03 | 2026-08-16 | AWS S3 for all file storage (private bucket, presigned access) | Client/stack decision |
| D-04 | 2026-08-16 | Packet layout is ours to define (canonical order in `packet-pdf-spec.md`); output is a normal PDF the org uploads to DocuSign (no integration) | Client confirmed |
| D-05 | 2026-08-16 | **Salary model:** summary sheet stays line-item level; per-person detail = ordinary expenses on the Salary line item (one expense per person per month, multiple proofs); people live in vendor library + recurring list. No payroll module. | Client delegated; matches real cover sheets 1:1 |
| D-09 | 2026-08-16 | Proofs render only on cover sheets, never as standalone packet pages; receipts/supporting/month docs render full-page, PDFs rasterized 1:1 at 150 DPI | Reviewers read receipts; kills manual duplication |
| D-10 | 2026-08-16 | Month documents (bank statements, timesheets, combined hours, fiduciary invoice) are packet-level attachments, placed after the summary section | Real packet contains month-scoped docs |
| D-11 | 2026-08-16 | Excel = exceljs (SheetJS CE can't style); Detail sheet gains Payment Source column, rows grouped by line item, sheet named `{Mon} Detail` (abbreviated) — deliberate deviations from prototype | Technical necessity + readability |
| D-12 | 2026-08-16 | Docker deploy so LibreOffice + poppler + Carlito font are available | Generation engine needs binaries |
| D-16 | 2026-08-16 | **Documentation gate:** proof always required; receipt/justification required unless "No receipt available" + reason (prints on cover sheet); mutually exclusive with attached receipts | Client confirmed; real packet has proof-only expenses |
| D-17 | 2026-08-16 | Docs-first AI-native workflow; per-module specs with derived Claude Design prompts + shared preamble | This repo's `docs/` |
| D-18 | 2026-08-16 | Standardizations vs manual: integer cents, `$#,##0.00`, canonical wordings, no filler rows, headings = table names, every row shows proofs; documentation gate extended to cover-sheet + contract-summary downloads (stricter than SOW's packet-only blocking); browser-print affordance dropped | Fixes recurring manual errors; gate is the product's core promise (review A18) |
| D-19 | 2026-08-16 | **Payment sources + supporting document types are org-configurable label lists** (seeded with the current defaults; expenses store label snapshots) | SOW §1 written commitment (review A1) |
| D-20 | 2026-08-16 | **No antivirus scanning in MVP.** Uploads are size/type constrained + server-processed (magic bytes, corrupt/encrypted rejection); risk accepted: private bucket, orgs download only their own originals, packet content is re-rasterized (strips active content) | Honest NFR (review A-virus) |
| D-21 | 2026-08-16 | **Submission integrity:** every downloaded artifact is pinned permanently (`downloaded_at`); months can be marked Submitted → edit warnings; full audit log deferred to phase 2 | Org must be able to prove what the City received (review A3) |
| D-22 | 2026-08-16 | Tax note always prints when tax > 0; a custom note prints **in addition**, never suppresses it | SOW §2 "is appended" (review A16) |
| D-23 | 2026-08-16 | Prototype's "Load/Clear sample data" affordance dropped — prototype-demo-only; real orgs onboard with real data | Review A17 |
| D-24 | 2026-08-16 | No self-serve password reset (email is out of scope): login shows "Forgot your password? Contact Mantaq."; operator reset runbook (CLI sets new argon2id hash after out-of-band identity check). Password min 12 chars + login throttling | Review A9 |
| D-25 | 2026-08-16 | **Accepted MVP risks (recorded, revisit phase 2):** hard deletes with no audit trail; last-write-wins concurrency on the shared account (no optimistic locking); login copy reveals account existence (fine while signup is gated); no per-person attribution on the single shared account | Sized for a $2k/10-day MVP |
| D-26 | 2026-08-16 | Timezone: all date-only values/"today"/month boundaries computed in **America/Detroit** (fixed org timezone) | Review A11 |
| D-27 | 2026-08-16 | Month selector = rolling window (−12…+3 + data months + "Earlier month…" picker); new-org active month = current month. Replaces prototype's fixed Jan–Dec 2026 list | Review (fidelity minor) |
| D-28 | 2026-08-16 | Adversarial review run and applied — findings + dispositions in `review-2026-08-16.md`; SOW capacity line (≥15 line items) added to acceptance; February test runs in production environment only | Quality gate before design/build |
| D-06 | 2026-08-16 | **Auth: custom session-based auth built into the app** — argon2id (`@node-rs/argon2`) passwords; DB `sessions` table storing SHA-256 of a 32-byte random cookie token; `HttpOnly/Secure/SameSite=Lax`; 30-day sliding TTL; logout = row delete; password change deletes all other sessions; CSRF via Server-Action origin checks + Origin verification on route handlers. Full design: architecture §Auth. Rationale: one credentials provider + hard revocation requirement — Auth.js Credentials forces JWT (revocation becomes a workaround) and fights password auth; Better Auth is the right tool only if OAuth/2FA/multi-user arrive (revisit then); ~200 lines of explicit, testable code fits AI-native ownership. No paid or AWS auth services (user constraint). | User directed: no paid/AWS auth; Claude chose the method |
| D-07 | 2026-08-16 | **Postgres self-hosted with Drizzle ORM** — Docker container + volume on Mantaq infra (local Postgres in dev); drizzle-kit migrations; schema authored in `src/db/schema.ts`. Backup regime unchanged and non-negotiable: nightly pg_dump → S3 (30 daily + 12 monthly), bucket versioning, one executed restore drill, host disk encryption. | User stack decision (Drizzle over Prisma) |

## Open

| # | Question | Default / recommendation | Needed by |
|---|---|---|---|
| D-08 | docx→PDF parity spike: LibreOffice (with Carlito) output must visually match Word rendering of the cover sheet | Spike Phase 3 day 1; fallback = parallel pdf-lib renderer sharing layout-constants | Phase 3 |
| D-13 | Real setup figures from Misty: line-item scheduled values + opening previously-billed, perf grant billed-to-date, advances received, PO/contract numbers | Use February packet figures as placeholders | Before go-live |
| D-14 | Go-live starting month + whether to back-enter prior months ("Earlier month…" picker supports it) | TBD with client | Before go-live |
| D-15 | Expose public signup later? Requires email verification first; `SIGNUP_ENABLED` stays false after Team Pursuit's org is created | Gated | Phase 4 |
