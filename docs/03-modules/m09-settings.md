# m09 — Settings

## Purpose
Everything the prototype hardcoded: org identity, one or more funding sources' contract/PO figures and reimbursement rules (D-93, Phase 6), the configurable label lists (D-19), vendor library management, account password.

## Scope
Route `/r/settings`, sidebar-sectioned single page (D-91). No month scoping.

## Data
`organizations` (name, doc_name), `funding_sources` (all contract/PO/advances/reimbursement fields — D-93; superseded `contract_settings`, which is kept in the database but no longer read or written), `payment_sources` + `supporting_doc_types` CRUD (R5.1/R11.1), `vendor_defaults` CRUD, `users` (password change). Rules R1.3, R7.3–R7.4 consume the figures. (The Performance Grant, R7.2, is retired — D-80 — replaced by per-line-item performances, m08.)

## Sections
1. **Organisation** — Organisation name; Document display name (`doc_name`, non-empty, helper: "Printed on cover sheets and the packet — e.g. 'Team Pursuit'"); below Save, a switch "Read amounts from uploaded documents" (Phase 10, D-105) — rendered only when the organisation's plan is `reconciliation_ai`, hidden entirely (not disabled) on the base plan. Admins toggle it immediately (`setReadAmountsEnabledAction`, admin-only); managers see it disabled. Help text: "Receipts and proofs of payment are sent to OpenAI to suggest amounts. OpenAI doesn't use them for training. Nothing is saved until you confirm."
2. **Funding sources** (D-93, replaces the old Contract and Advances sections) — a list of the organisation's funding sources (name, type, archived badge, Edit, Archive/Unarchive), and an add/edit form: name (required, unique per org), type (Grant/Donation/Line of credit/Other), document name (optional — placeholder shows the organisation's own doc name, used when blank), Project name, Contract number, Base PO number, Performance PO number, Total contract value (optional, else derived), Contract start/end, Fiduciary name, Advances received, and two checkboxes — "This funder reimburses sales tax" / "…fees" (moved here from payment sources, R1.3). Admins and managers may both create/edit/archive. Archiving requires at least one other active source remaining, and clears the organisation's active selection if it pointed at the archived source.
3. **Lists** — two editors side by side (D-19, SOW §1 configurability):
   - *Payment sources:* rows `label | active toggle | Edit`, `+ Add payment source`. Deactivating hides from pickers; history keeps its snapshot (R5.1). At least one active source required. As of D-93, a payment source means only *how* something was paid — it no longer carries tax/fee reimbursement rules.
   - *Supporting document types:* same editor, seeded six (R11.1).
4. **Vendor library** — searchable table `Name | Default line item | Default description | Edit · Delete`; note: "The library learns automatically every time you save an expense."
5. **Plan & billing** (Phase 16 §4.3, D4: near the end) — the org's plan from `planBillingView()`: complimentary (with a 14-day ending warning), subscribed (plan, billed monthly/yearly, renewal or last day, a scheduled downgrade or price change, an upgrade waiting for payment, a failed payment), or none. Admins get Switch plan (Stripe quote shown before anything changes), Card and invoices (Stripe's portal), Cancel plan / Keep my plan, End plan now after a failed payment; managers see the state and who the admins are. The Plus pill in the header and every billing banner link here.
6. **Account** — email (read-only MVP), change password (current + new ×2, min 12 chars; changing it signs out other sessions — D-06).

`?section=<id>` opens a section directly (`parseSettingsSection`); an unknown value, or Users for a manager, opens Organization. Each section saves independently with inline confirmation ("Saved").

## Server surface
`updateOrganisationAction`, `createFundingSourceAction`, `updateFundingSourceAction`, `archiveFundingSourceAction`, `unarchiveFundingSourceAction` (all in `src/modules/funding-sources/actions.ts`, `actionSession()` not `requireAdmin()` — D-93), `saveLabelAction`, `setLabelActiveAction`, `saveVendorAction`, `deleteVendorAction`, `changePasswordAction`, `setReadAmountsEnabledAction` (`requireAdmin()` — Phase 10, D-105). Plan & billing calls the billing actions in `src/modules/billing/actions.ts` (Phase 16 §4.1; admin-checked inside each).

## Acceptance
Doc name flows into all generated filenames/titles, except for a funding source that sets its own document name, which wins for that source's documents (D-93); PO/advance edits change m07 + Excel immediately; list edits flow into m02 pickers and m03 cards while history keeps old labels; vendor edits affect autofill; password change re-hashes, keeps the current session, and invalidates others.

---

## Claude Design prompt

```
Design the SETTINGS screen inside the app chrome (Settings tab active).

h1 "Settings". Stacked bordered white cards, each with a Georgia 20px section title, fields
in a 2-column grid (stack on mobile), and its own primary "Save" button bottom-right with a
small green "Saved" confirmation example in one card.

Card 1 "Organization": "Organization name" = "Team Pursuit Global"; "Document display name" =
"Team Pursuit" with helper "Printed on cover sheets and the packet."

Card 2 "Contract": Project name = "Community Violence Intervention"; Contract number =
"6007211"; Base PO number = "3086984"; Performance PO number = "3089749"; Total contract
value = "$940,000.00" with helper "Leave at 0.00 to use the total of the line items' scheduled values."; Contract
start = 07/01/2025; Contract end = 06/30/2026; Fiduciary name = "Detroit Crime Commission".

Card 3 "Advances": Total advances received = "$665,000.00" with helper "Appears in the
reconciliation section of the summary."

Card 4 "Lists" — two columns:
Left, "Payment sources" with three rows, each: label text + a small "Active" toggle (on) +
quiet "Edit" link — "Paid by us, reimbursement requested", "Invoiced to fiduciary in
advance", "Paid directly by fiduciary" — then a secondary "+ Add payment source" button.
Right, "Supporting document types" with six compact rows (same pattern): Check copy,
Request form, Vendor invoice, Event flyer, Narrative, Other — then "+ Add document type".
Small helper under both: "Renames apply to menus going forward; saved expenses keep the
label they were entered with."

Card 5 "Vendor library": a search input "Search vendors", then a table Name | Default line
item | Default description | actions with 5 rows:
  Quincy Smith | Salary | Director | Edit · Delete
  Adobe | Analytical Support | Software to support Team Pursuit including PDF generation… | Edit · Delete
  Google Workspace | Promotional & Marketing | Utilized for Google based apps and outreach | Edit · Delete
  Hiscox | Analytical Support | Insurance for Team Pursuit systems and programs | Edit · Delete
  Mantaq (Kaleem) | Analytical Support | Contracted support for chatbot and web app development | Edit · Delete
Under it a quiet note: "The library learns automatically every time you save an expense."

Card 6 "Account": Email (read-only, team@teampursuitglobal.org), Current password, New
password (helper "At least 12 characters"), Confirm new password, primary "Change password".
```
