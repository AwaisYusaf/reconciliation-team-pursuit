# m09 — Settings

## Purpose
Everything the prototype hardcoded: org identity, one or more funding sources' contract/PO figures and reimbursement rules (D-93, Phase 6), the configurable label lists (D-19), vendor library management, account password.

## Scope
Route `/r/settings`, sidebar-sectioned single page (D-91). No month scoping.

## Data
`organizations` (name, doc_name), `funding_sources` (all contract/PO/advances/reimbursement fields — D-93; superseded `contract_settings`, which is kept in the database but no longer read or written), `payment_sources` + `supporting_doc_types` CRUD (R5.1/R11.1), `vendor_defaults` CRUD, `users` (password change). Rules R1.3, R7.3–R7.4 consume the figures. (The Performance Grant, R7.2, is retired — D-80 — replaced by per-line-item performances, m08.)

## Sections
1. **Organisation** — Organisation name; Document display name (`doc_name`, non-empty, helper: "Printed on cover sheets and the packet — e.g. 'Team Pursuit'"); below Save, a switch "Read amounts from uploaded documents" (Phase 10, D-105) — rendered only when the organisation's plan is `reconciliation_ai`, hidden entirely (not disabled) on the base plan. Admins toggle it immediately (`setReadAmountsEnabledAction`, admin-only); managers see it disabled. Help text: "Receipts and proofs of payment are sent to OpenAI to suggest amounts, and a receipt's vendor and date. OpenAI doesn't use them for training. Nothing is saved until you confirm." (Phase 19 added the vendor and date; the switch label is unchanged.)
2. **Funding sources** (D-93, replaces the old Contract and Advances sections) — a list of the organisation's funding sources (name, type, archived badge, Edit, Archive/Unarchive), and an add/edit form: name (required, unique per org), type (Grant/Donation/Line of credit/Other), Document display name (optional — placeholder shows the organisation's own, used when blank; the details then say "Same as the organization"), Project name, Contract number, Base PO number, Performance PO number, Total contract value (optional, else derived), Contract start/end, Fiduciary name, Advances received, and two checkboxes — "This funder reimburses sales tax" / "…fees" (moved here from payment sources, R1.3). Admins and managers may both create/edit/archive, on a paid plan. Archiving requires at least one other active source remaining (Archive isn't offered on the only one, and the server refuses with `fundingSourceKeepOneActive`), and clears the organisation's active selection if it pointed at the archived source (`src/modules/funding-sources/archive.ts`, shared with the billing sync, D-129). Empty optional fields are listed once under the details as "Not filled in: …". With new performances (D-82) the details' Contract value tile reads the value with a second line `+ Performances $10,000.00 = Total $160,000.00`; without them, just the value. The form's contract value helper adds, when there are any, `Performances added on the Line Items screen ($X) are added on top of this.` A contract value that would put the contract total below the line items is refused with `UI.contractValueBelowLineItems` (R9.6, D-134), unless the source is already over and the change doesn't make it worse; clearing it (blank or 0) removes the limit. An end date before the start date is refused. A refusal stays in the form, above Cancel/Save, not only in a toast. Money inputs start with grouped figures (`150,000.00`).
3. **Lists** — two editors side by side (D-19, SOW §1 configurability):
   - *Payment sources:* rows `label | active toggle | Edit`, `+ Add payment source`. Deactivating hides from pickers; history keeps its snapshot (R5.1). At least one active source required. As of D-93, a payment source means only *how* something was paid — it no longer carries tax/fee reimbursement rules.
   - *Supporting document types:* same editor, seeded six (R11.1).
4. **Vendor library** — searchable table `Name | Default line item | Default description | Edit · Delete`; note: "The library learns automatically every time you save an expense."
5. **Users (admins only)** (D-85, D-120) — the organization's users, with Edit name, Reset password, Remove/Restore access and Delete account per row, and an Add user row (name, email). Under the Add user row, one line says what a new user can do (usability #49): `New users are added as Managers. A Manager can do everything except manage users, change the plan or billing, change AI settings, and see an expense's History.` (`UI.managerRoleHint`; update it if the admin-only list changes). Adding a user or resetting a password without typing one shows the generated password once, in a neutral panel (not the red danger styling, usability #50), with the sign-in page `{APP_URL origin}/login` beside it and `Send both to the user yourself, for example by text. The password can't be shown again.` Its `Copy both` button copies one ready-to-send sentence: `Sign in at {link} with your email address and this password: {password}` (usability #51). The link comes from `APP_URL` via `siteOrigin()`, not the browser's address.
6. **Plan & billing** (Phase 16 §4.3, D4: near the end; shown only while billing is on, so nothing changes in Settings until go-live) — the org's plan from `planBillingView()`: complimentary (with a 14-day ending warning), subscribed (plan, billed monthly/yearly, renewal or last day, a scheduled downgrade or price change, an upgrade waiting for payment, a failed payment), or none. Admins get Switch plan (Stripe quote shown before anything changes), Card and invoices (Stripe's portal), Cancel plan / Keep my plan, End plan now after a failed payment; managers see the state and who the admins are. A complimentary org's admin can buy a plan at any time: they pay today and the complimentary access ends once that payment goes through (D-128). Choosing Reconciliation with several active funding sources asks which one to keep, here as on `/r/plan`; nothing is archived then, and the others are archived once the payment goes through (D-129). While a paid plan still runs beside complimentary access (staff chose to cancel it at the end of its period), the section says so ("Your paid {plan} plan ends on {date}. Your complimentary access continues.", or that it renews and is charged, or that its last payment failed), with Card and invoices, and Cancel plan while it would renew and its payment hasn't failed. No See plans and no ending-soon banner then: no other plan can be bought until it ends. The Plus pill in the header and every billing banner link here. A plan on hold (Stripe stopped retrying a failed payment, or paused it) cuts access, so the same panel is shown on `/r/plan` instead, where the unpaid org lands (D-126).
7. **Account** — email (read-only MVP), change password (current + new ×2, min 12 chars; changing it signs out other sessions — D-06).

`?section=<id>` opens a section directly (`parseSettingsSection`); an unknown value, Users for a manager, or Plan & billing while billing is off opens Organization. Each section saves independently with inline confirmation ("Saved").

## Server surface
`updateOrganisationAction`, `createFundingSourceAction`, `updateFundingSourceAction`, `archiveFundingSourceAction`, `unarchiveFundingSourceAction` (all in `src/modules/funding-sources/actions.ts`, `actionSession()` not `requireAdmin()` — D-93), `saveLabelAction`, `setLabelActiveAction`, `saveVendorAction` (the default line item must be one of the organisation's own), `deleteVendorAction`, `changePasswordAction`, `setReadAmountsEnabledAction` (`requireAdmin()` — Phase 10, D-105). Plan & billing calls the billing actions in `src/modules/billing/actions.ts` (Phase 16 §4.1; admin-checked inside each).

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
