# Documentation — Stay Funded 360

Docs-first, AI-native project. **These files are the source of truth.** Code serves the docs; when reality diverges, update the doc in the same change.

## Map

| Path | What it is |
|---|---|
| `TASKS.md` | **Outstanding work** — everything unfinished, why it matters, and what is blocked on whom |
| `redesign-brief.md` | **The 2026-09 visual redesign** — the brief the app shell, type, colour and table work was built against: Plus Jakarta Sans throughout, the cooler `paper` behind raised white cards, the single sticky header that replaced three stacked rows, the month and funding-source selectors moved level with each screen's title (and the `ACTION_CLEARANCE` every screen with its own corner controls needs), the gradient heading and table-header band, skeleton `loading.tsx` per route, and the profile menu that replaced the standalone Sign out button. Profile photos are D-117; draft last-saved attribution, built alongside it, is D-118 |
| `PHASE-15.md` | **Phase 15**: paying for a plan with Stripe. Choose Reconciliation or Reconciliation + AI, monthly or yearly, on Stripe Checkout; a Plan & billing section in Settings (first in the sidebar, deep-linkable) with switch, cancel, undo, and card and invoices; the Plus pill opens it. Upgrades are charged now and apply only when paid, downgrades wait for the period end (D-119); Stripe is the record and one sync writes the copy, with no new enum values (D-120). No free use, one funding source on Reconciliation, prices as constants that the landing page follows (D-121). Acceptance criteria in groups A to P, each mapped to unit, integration, Stripe sandbox (test clocks) and browser tests; nine build phases, 0 to 8 (plan, not started; yearly amounts and four landing-page feature claims still to confirm) |
| `PHASE-12.md` | **Phase 12** — sharing a month's packet PDF or Excel summary by public link: one link per file per source and month, optional password with a per-visitor lockout, update-in-place after records change, stop sharing, links off while the org is paused or cancelled; the first unauthenticated surface (D-112); the ticket verbatim (Appendix A), five build phases (Phases 1–4 built, reviewed and browser-tested in Chrome; Phase 5's 70 MB packet run and the Edge and Safari passes still to do) |
| `PHASE-14.md` | **Phase 14** — adding many expenses from one invoice: upload one multi-line vendor PDF, read its lines, create one **draft** per line, and approve them from a "Waiting for review" section on the Expenses list. A draft counts in nothing until approved, which is a property of its own two tables (`expense_imports`, `expense_drafts`) rather than of a filter on `expenses` (D-115); a draft also carries its own files in `expense_draft_documents`, which approval re-points at the expense (D-116); also records why D-106's two-migration mitigation for Postgres enum values does not work. The ticket is `tickets/upload-invoices.md` (all phases built; §9 records the pre-merge review and where the shipped flow departs from the ticket) |
| `PHASE-13.md` | **Phase 13**: no em or en dashes in anything the app writes (screens, packet, cover sheets, Excel, AI drafts), with bars on documents and typed text left as typed (D-113); a copy review of every user-facing string against the "Words" rules, every change listed before and after |
| `PHASE-11.md` | **Phase 11** — AI-drafted monthly summary (Reconciliation + AI plan): facts computed by the app, figure verification, per-source-per-month storage, its own screen with saved months, plain Markdown editing with autosave, Word and PDF download, change notice; agreed changes to the ticket, edge cases mapped to tests, six build phases (Phases 1–5 built: foundations, writing, the screen with autosave and the packet card, Word and PDF download, the Dashboard link, the packet tour step and module doc) |
| `PHASE-10.md` | **Phase 10** — reading Subtotal/Tax/Fees/Total from receipts and proofs with OpenAI: the plan gate (`canReadAmounts`), the `ai_usage_events` usage log (renamed from `amount_reads`, D-106), the read route, the Add/Edit panel and Settings switch; the product spec verbatim (Appendix A), decisions taken before building, design, and the verification record (built and browser-verified; real OpenAI test waiting on account credit) |
| `PHASE-9.md` | **Phase 9** — the AB Solutions staff dashboard at `/a`: staff accounts in their own tables, the staff gate, plan/status/complimentary/suspension with a history, and the organizations directory; the product spec verbatim (Appendix A), the five-phase build plan and the Results of each, including the Phase 5 browser walk-through of every "Done when" line (built and verified; **not yet deployed** — see the deploy note in §8 Phase 5) |
| `PHASE-8.md` | **Phase 8** — locking a reconciled month: signed copy storage, the lock guard on every month-scoped write, Reconciled state and reporting periods; build plan and Results (built; not yet deployed) |
| `PHASE-7.md` | **Phase 7** — guided first-run tours for Dashboard, Add Expense, Recurring and Month-End Packet: persistence model, tour engine decision, phased build plan (not started) |
| `PHASE-6.md` | **Phase 6** — multiple funding sources per organisation: data model, migration, phased build plan, acceptance proof, and the Results of the migration/rollback rehearsal (built; not yet deployed) |
| `PHASE-5.md` | **Phase 5** — packet navigation: clickable references, page map, outline; plan and passing criteria, blocked on six decisions |
| `PHASE-4.md` | **Phase 4** — Misty submission feedback: the deployed cover-sheet fix, and moving month documents to the end |
| `PHASE-3.md` | **Phase 3** — the three fixes Misty reported after testing, phased with passing criteria |
| `PHASE-2.md` | **Phase 2 enhancements** — the six client-requested changes, phased, with passing criteria and the open questions each one is blocked on |
| `00-product/prd.md` | Product requirements — problem, scope, flows, acceptance |
| `01-domain/domain-rules.md` | The rulebook: money math, gates, statuses, canonical wordings |
| `01-domain/data-model.md` | Entities, fields, relationships, S3 key scheme |
| `02-outputs/cover-sheet-spec.md` | Word + PDF cover sheet ("Breakdown" doc) format spec |
| `02-outputs/summary-excel-spec.md` | Excel contract summary format spec |
| `02-outputs/packet-pdf-spec.md` | Merged month-end packet PDF: canonical order, rasterization, footer |
| `03-modules/design-language.md` | Shared visual language + the paste-first Claude Design preamble |
| `03-modules/m00…m11-*.md` | Per-module spec + self-contained Claude Design prompt |
| `03-modules/design-review.md` | Fetched-design analysis: dc format, per-screen verdicts, adopted patterns, refetch instructions |
| `04-engineering/architecture.md` | Stack, layers, folder conventions, generation engine, ops, testing |
| `04-engineering/decisions.md` | Decision log — settled and open |
| `04-engineering/review-2026-08-16.md` | Adversarial review of the documentation (4 auditors) — findings + dispositions, all applied |
| `04-engineering/review-2026-08-16-implementation.md` | Adversarial review of the first implementation phase |
| `04-engineering/review-2026-08-16-generation.md` | Adversarial review of the generation layer (snapshot, workbook, artifact cache, download route) |
| `04-engineering/review-2026-08-17-outputs.md` | Adversarial review of the cover sheet and packet generators — two critical defects, fixes, and deferred scheduling work |
| `04-engineering/review-2026-08-17-board.md` | Adversarial review of the screens, actions, auth and spec conformance |
| `04-engineering/review-2026-08-17-responsive.md` | Mobile and tablet UI review — measurements, the shared scale, and results |
| `04-engineering/review-2026-08-17-auth.md` | Authentication hardening review — memory-exhaustion DoS, phantom AUTH_SECRET, and the rest |
| `04-engineering/deploy-ec2.md` | EC2 deployment — why this shape, operations, redeploys, rollback |
| `04-engineering/ec2-first-deploy.md` | First deployment, step by step: DNS, S3, IAM, swap, clone, Caddy, reboot test |
| `04-engineering/review-2026-08-20-february.md` | The February test — cover sheet conformance against the client's approved document |
| `04-engineering/scenarios.md` | The twelve end-to-end scenarios, written before being run, with results |

Reference inputs (not authored by us) live in `../context/`:
- `Reconciliation System MVP For Team Pursuit Global By Mantaq.pdf` — signed scope of work
- `manual packet/` — the client's real, approved February 2026 packet + manual Word cover sheets. **Golden reference for all generated outputs. Contains real PII — git-ignored, never commit or publish.**

## Build pipeline (per module)

Each `03-modules/m*.md` is one unit of work that flows through five gates:

1. **Spec** — written here (module file). Behavior references `domain-rules.md`; data references `data-model.md`; never duplicated.
2. **Design** — paste `design-language.md` preamble + the module file's "Claude Design prompt" section into Claude Design; client-facing UI comes back as an artifact.
3. **Fetch** — Claude Code fetches the module's `.dc.html` from the Claude Design project via DesignSync (projectId in `03-modules/design-review.md`) and reviews it against the spec.
4. **Page** — Claude Code implements the Next.js page(s) from spec + fetched design. Spec wins on conflict with the design; design wins on pure visuals.
5. **Wire** — backend (server actions/routes, DB, S3) makes it functional; acceptance checks in the module file pass.

### Module status

| Module | Spec | Prompt | Design | Page | Wired |
|---|---|---|---|---|---|
| m00 App shell & auth | ✅ | ✅ | ✅ | ✅ | ✅ |
| m01 Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| m02 Expense entry | ✅ | ✅ | ✅ | ✅ | ✅ |
| m03 Expenses list | ✅ | ✅ | ✅ | ✅ | ✅ |
| m04 Cover sheets | ✅ | ✅ | ✅ | ✅ | ✅ |
| m05 Recurring items | ✅ | ✅ | ✅ | ✅ | ✅ |
| m06 Month-end packet | ✅ | ✅ | ✅ | ✅ | ✅ |
| m07 Contract summary | ✅ | ✅ | ✅ | ✅ | ✅ |
| m08 Line items | ✅ | ✅ | ✅ | ✅ | ✅ |
| m09 Settings | ✅ | ✅ | ✅ | ✅ | ✅ |
| m10 Admin dashboard | ✅ | ✅ | n/a | ✅ | ✅ |
| m11 Monthly summary | ✅ | n/a | n/a | ✅ | ✅ |

m10's Design gate is `n/a` deliberately: the prompt is written in the module file, but no
Claude Design pass was run — the screens were built from the existing component kit, since
`/a` is a staff-only tool with no client-facing visual requirement (D-100, Phase 9 §7 Q11).
m11 likewise had no Claude Design pass — built from the existing component kit and Phase 10's
Plus styling (PHASE-11.md §9 Phase 3).

Output generators (cover sheets, Excel, packet) are backend work items specced in `02-outputs/` and wired during m04/m06/m07.

## Working rules for AI sessions

- Before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/` — this repo runs Next 16; APIs differ from training data (see `/AGENTS.md`).
- Money is integer cents everywhere in code. Formatting only at the edge (`domain-rules.md` §1).
- Exact output wordings and formats come from `01-domain` + `02-outputs` — never improvise strings that print on documents.
- New product decisions go to `04-engineering/decisions.md` the moment they're made; open questions live there too.
- Update the module status table above as gates complete.

## Build progress (updated as modules land)

Working software so far, all verified against a running app with a real database:

| Landed | What exists |
|---|---|
| Foundation | Drizzle schema (14 tables) + migrations + seed + dev fixture; custom session auth; Tailwind design tokens and the shared component library; m00 auth/onboarding/app shell |
| Domain | money · format · dates · strings · budget-math (R3) · gate (R4) · summary (R7) · line-item-rules (R9) · recurring-rules (R8) — all pure, all unit-tested |
| Storage | Driver abstraction (S3 + local, D-29), key rules, upload inspection, server-proxied ingestion (D-30), download-by-id route |
| Screens | All ten customer screens: m00 shell/auth · m01 dashboard · m02 expense entry · m03 expenses list · m04 cover sheets · m05 recurring · m06 month-end packet · m07 contract summary · m08 line items · m09 settings — plus m10, the AB Solutions staff dashboard at `/a` (Phase 9), which customers of any role cannot reach |
| Generators | All three outputs: summary workbook (xlsx) · cover sheet (docx canonical + PDF) · month-end packet (merged, ordered, footer-stamped, size ladder). Shared month snapshot, rasterization (pdftoppm 150 DPI, page-at-a-time), artifact cache with inputs-hash and download pinning (R10.4, R10.6), gated download routes |

Every module has shipped and the twelve end-to-end scenarios in `scenarios.md` all
pass, including the one that matters most: the same figure is identical on the
dashboard, the contract summary screen, the packet, the cover sheet and the workbook
(R10.2). The production build compiles.

**Remaining:** the generation scheduling work deferred in
`review-2026-08-17-outputs.md` (single-flight lock, wall-clock bound, packet memory) ·
phase-4 hardening (Playwright, the February test) · the client figures behind D-13.
Deployment and the nightly backup regime have landed.

### Running it locally

```bash
createdb ngo_expenses          # once
cp .env.example .env.local     # set DATABASE_URL to your local Postgres
npm run db:migrate
npm run db:seed                # creates the client org (no PII)
npm run db:fixture             # optional: February expenses for development
npm run db:fixture -- docs     # optional: attach proof+receipt to each, opening the gate
npm run dev
```

Operator password reset (D-24 — the only recovery path, since there is no self-serve reset).
It revokes every session for that user as well as setting the new hash:

```bash
npm run db:reset-password -- --email team@example.org
```

Sign in with the credentials `db:seed` prints. Downloads stay blocked until every expense
in the month carries its documents (R4.3), which is what `db:fixture -- docs` sets up.

Document generation shells out to two binaries, both of which the deployment container
ships. Install them locally to generate cover sheets and packets:

```bash
brew install poppler                  # pdftoppm/pdfinfo — rasterizing PDF proofs
brew install --cask libreoffice       # soffice — docx to PDF conversion
```

`SOFFICE_PATH` overrides the LibreOffice location if yours is elsewhere; the macOS app
bundle path is already tried, so the cask needs no configuration.

`npm test` runs unit and integration suites. Integration tests skip cleanly without
`DATABASE_URL`, and the rasterization and conversion tests skip without their binaries —
so the suite stays green on a bare machine, but only a fully equipped one proves the
generators work.
