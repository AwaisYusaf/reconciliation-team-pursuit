# PRD — Stay Funded 360 (MVP)

**Client:** Team Pursuit Global (Detroit CVI/ShotStoppers subrecipient) · **Builder:** Mantaq · **SOW:** signed 2026-08-13 (`context/…SOW.pdf`) · **Prototype:** approved Claude artifact "Month and Download Features"

## 1. Problem

Team Pursuit submits a monthly reconciliation packet to the City of Detroit (via fiduciary Detroit Crime Commission). Today it is built by hand: expenses collected from bank statements at month-end, Word "Breakdown" cover sheets with pasted screenshot crops, an Excel contract summary, and a ~130-page merged, page-numbered PDF. It takes 2–3 working days per month and produces recurring errors: missed expenses, cover-sheet totals that don't reconcile with the summary, missing receipts/proofs discovered at submission, format drift ("$3.916.70", mismatched titles), and packets bounced back by reviewers. The approved February 2026 packet in `context/manual packet/` is the ground truth of what "done" looks like.

**Goal:** capture each expense once, at the moment it happens, with its documents — then generate the entire packet in minutes, always internally consistent, in the format the City already accepts.

## 2. Users

| User | Context |
|---|---|
| Org staff (Misty — Program Manager, Quincy — Director) | Non-technical; phone + laptop; enter expenses, upload documents, download outputs. Single shared org account in MVP. |
| Fiduciary (DCC) / City reviewers | Never log in. Receive the generated packet (uploaded to DocuSign by the org) and the Excel summary. Outputs must look familiar. |
| Future orgs | Same system, different config (line items, contract) — sign-up + onboarding exists so a new org can start without a rebuild. |

## 3. Success criteria

1. **The February test:** re-enter February 2026 from the real documents; the generated packet + summary are accepted by Misty as city-submittable without manual editing.
2. Month-end packet production time: from 2–3 days to **under 30 minutes** of user effort (assuming expenses were entered during the month).
3. Zero internal inconsistencies possible: cover sheet totals, summary sheet, and dashboard all derive from the same records.
4. Downloads are impossible while documentation is incomplete, and the system says exactly what's missing.
5. Client-approved UI (Claude Design) faithfully implemented; usable by non-technical staff without training beyond a walkthrough.

## 4. Scope

### In scope (MVP)

- **Auth & org onboarding:** email+password sign-in; sign-up; 2-step onboarding, funding first (funding name + total amount required, dates and fiduciary optional; then line items that must fit the total; not skippable, D-134). Single account per org.
- **8 app screens:** Dashboard, Add Expense, Expenses, Cover Sheets, Recurring, Month-End Packet, Contract Summary, Line Items — plus **Settings** (org/contract config the prototype hardcoded).
- **Expense capture:** name/label, line item, month + date, payment source, description(role), subtotal/tax/fees, inline note + narrative note, 1–n proofs of payment, receipt/justification docs (or explicit "no receipt available" + reason), typed supporting documents. Edit (incl. moving between months) + delete. Vendor library autofill (auto-learning). Recurring items one-click add.
- **Configurable lists (SOW §1):** payment sources and supporting document types are org-editable label lists seeded with the defaults (D-19); line items fully managed.
- **Submission integrity:** every downloaded artifact is pinned permanently; months can be marked Submitted, warning on later edits (D-21).
- **Month documents:** packet-level uploads (bank statements, timesheets, combined-hours sheet, fiduciary invoice, other) attached to a month, not an expense.
- **Outputs:** per-line-item cover sheet as **Word + PDF**; **Excel** contract summary (2 sheets); merged, page-numbered **packet PDF** (DocuSign-uploadable). All gated by the documentation rule.
- **Infra:** AWS S3 private file storage; Postgres; deployed on Mantaq infrastructure.

### Out of scope (MVP) — from SOW §3 + confirmed decisions

Receipt OCR/auto-extraction; bank feed integration; ~~multi-project/multi-grant per org~~ — **now in scope as of Phase 6 (D-93):** an organisation can hold several funding sources, each with its own line items, expenses, packets and rules, never mixed (`docs/PHASE-6.md`; still out of scope: splitting one expense across sources, per-source user permissions, non-calendar reporting periods, combined cross-source reports); the City's full continuation-sheet template (per-person salary rows on the summary — **decided:** summary stays line-item level; per-person detail lives on the Salary cover sheet); DocuSign integration (output is a normal PDF the org uploads); email sending; multi-user roles/permissions per org; accounting integrations; in-system billing of performance grants (settings-level figures only).

## 5. Core concepts

| Concept | Meaning |
|---|---|
| **Month** | The reporting period (e.g., `2026-02`). Every expense and month document belongs to exactly one. Header selector switches the whole app. |
| **Line item** | Funder-approved budget category with scheduled value + opening previously-billed balance. |
| **Expense** | One row on a cover sheet. Name = payee/label (vendor, person, or "ATM Withdrawal"), description = the "Role" column text, amount = the reimbursable part of the receipt, which parts being per-funder (R1.3). One per person per month for salary. |
| **Proof of payment** | 1–n images/PDF crops evidencing money moved (bank transaction crops, app payment screenshots). Rendered on the cover sheet under the payee heading. Always required. |
| **Receipt / justification** | 1–n docs saying what was owed: receipt, invoice, or timesheet. Required unless "no receipt available" + reason (reason prints on the cover sheet). |
| **Supporting document** | Typed extra evidence per expense: Check copy, Request form, Vendor invoice, Event flyer, Narrative, Other. |
| **Month document** | Packet-level doc for the month: bank statement, timesheet, combined hours, fiduciary invoice, other. |
| **Packet** | The merged, ordered, page-numbered PDF for a month (see `02-outputs/packet-pdf-spec.md`). |

## 6. The monthly cycle (primary flow)

1. **Setup (once):** onboarding sets up the funding first (name + total amount required, dates and fiduciary optional), then line items/budgets that must fit that total (not skippable, D-134); Settings screen refines POs, performance grant figures, advances, fiduciary, document display name.
2. **During the month:** each purchase/payment is entered when it happens — autofill from vendor library, live reimbursable + projected-remaining feedback, documents uploaded to the expense. Recurring screen adds the fixed monthly set (subscriptions, salaries) in clicks; each lands documentation-incomplete until proofs are attached.
3. **Month-end:** upload month documents (bank statements, combined hours…). Packet screen shows per-line-item readiness and a blocking list naming every record missing proof or receipt/justification, with jump-to-fix. When clear: download packet PDF + summary Excel; per-line-item Word/PDF cover sheets from the Cover Sheets screen.
4. **Submission (outside the system):** org uploads the packet PDF to DocuSign for signatures (org director, DCC, City).

Secondary flows: correcting an expense (edit/delete, re-generate); adding a line item mid-year; renaming a line item (cascades); month switch to view/complete a past month; new-org signup → onboarding → empty states.

## 7. Functional requirements (index)

Details live in module specs (`03-modules/`) and output specs (`02-outputs/`). Binding behavior rules live in `01-domain/domain-rules.md`.

| ID | Requirement | Where |
|---|---|---|
| FR-1 | Auth: sign in/out, sign up, onboarding (funding first, then line items that fit its total; not skippable, D-134) | m00 |
| FR-2 | App shell: org header, month selector (persisted), 9-item nav, log out | m00 |
| FR-3 | Dashboard: per-line-item Budget / Spent This Month / Total Spent / Remaining with <10% warning | m01 |
| FR-4 | Add/edit expense with all fields, live math, autofill, document uploads, no-receipt flow | m02 |
| FR-5 | Expenses list: payment-source summary cards, filters, document status, edit/delete | m03 |
| FR-6 | Cover sheets: on-screen preview per line item, Word + PDF download | m04, cover-sheet-spec |
| FR-7 | Recurring: managed list, one-click add-to-month, added-state, custom items | m05 |
| FR-8 | Packet: readiness table, blocking list, month documents manager, packet PDF + Excel download | m06, packet-pdf-spec |
| FR-9 | Contract summary screen mirroring the Excel + reconciliation block | m07, summary-excel-spec |
| FR-10 | Line items CRUD: add, rename (cascade), delete (blocked when used), budgets | m08 |
| FR-11 | Settings: org document name, contract/PO numbers, performance grant, advances, fiduciary, payment-source + supporting-doc-type lists, vendor library, password | m09 |
| FR-12 | Generators: cover sheet docx+pdf, summary xlsx, merged packet pdf — byte-consistent with specs | 02-outputs |
| FR-13 | Files: private S3, presigned upload/download, images + PDFs accepted, size limits | data-model, architecture |

## 8. Non-functional requirements

- **Security/privacy:** documents contain bank account/routing numbers, home addresses, participant names. Private S3 bucket only (no public objects), PII-free object keys, presigned URLs with short TTL, authenticated + org-scoped access checks on every read and presign, argon2id password hashing (min 12 chars), login/presign rate limiting, HTTPS only. No third-party analytics or scripts anywhere in the app. Logs carry IDs and counts only — never expense names, filenames, or request bodies.
- **Robustness:** integer-cents money; server-validated inputs; generation is deterministic (same data → same document); uploads size/type constrained and server-processed before counting as attached (images: jpg/png/webp/heic; docs: pdf; ≤ 25 MB each; no antivirus in MVP — D-20); nightly Postgres backups to S3 with a documented restore procedure; per-org storage caps (R13).
- **Performance:** packet generation for a 130-page month completes ≤ 60 s and streams a download; screens interactive < 2 s on ordinary connections.
- **Compatibility:** .docx opens correctly in Word + Google Docs; .xlsx in Excel + Sheets; packet PDF ≤ 25 MB (DocuSign envelope limit) at ~150 DPI rasterization; Letter size.
- **Usability:** matches approved design language; ≥ 44 px touch targets; every blocked action explains itself with specifics.

## 9. Delivery plan (maps SOW §5, 7–10 working days)

| Phase | Contents |
|---|---|
| 1. Foundation | Auth + shell + Settings + line items + data layer + S3 plumbing (m00, m08, m09) |
| 2. Capture | Expense entry + list + recurring + vendor library (m02, m03, m05, m01) |
| 3. Outputs | Generators + cover sheets, packet, contract summary screens (m04, m06, m07, 02-outputs) |
| 4. Hardening | The February test, fixes, deployment on Mantaq infra, walkthrough with Misty |

## 10. Open questions

Tracked in `04-engineering/decisions.md` — currently: real setup figures (line-item scheduled values + opening balances, perf grant billed-to-date, advances), starting month for go-live, docx→PDF conversion spike outcome (D-08). Stack is fully settled: Next.js 16 · self-hosted Postgres + Drizzle · custom session auth (D-06) · AWS S3 · Docker on Mantaq infra.
