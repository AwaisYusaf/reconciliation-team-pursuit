# m05 — Recurring Items

## Purpose
The fixed monthly set — software subscriptions and salaries — added to a month in clicks instead of re-typed. Nothing is ever automatic (R8.3).

## Scope
Route `/recurring`. Managed list (CRUD) + per-row "Add to {month}" with added-state and undo.

## Data
Reads/writes `recurring_items`; creates `expenses` (no documents — R4.5). Added detection: an expense exists in the active month with the same name (case-insensitive) + line item.

## Behavior
- Table: `Name | Amount | Line Item | (action)`. Action: secondary `Add to {Mon}` → creates expense (month = active month, date = today per R2.5, payment source default = the org's first active source, description = default description or vendor-library default), row flashes green and becomes `Added to {Month}` + quiet `Remove`.
- **Remove** deletes the newest matching expense; if that expense has ≥ 1 document attached, a confirm dialog is required first (R8.3).
- Subtext: `Vendors and salaries billed every month. Nothing is added automatically — confirm each one you want to add to {Month YYYY}.`
- `+ Add recurring item` inline form: name, amount, line item, optional description. Edit/delete per row (delete = list only, never touches expenses). Recurring items are cascade-deleted with their line item after the R9.3 confirm.
- Added-then-documented flow: the created expense is documentation-incomplete until proofs are attached — packet gate surfaces it (deliberate).

## Server surface
`saveRecurringItem` (create/update), `deleteRecurringItem`, `addRecurringToMonth(id)`, `removeRecurringFromMonth(id)` (confirm-gated when documents exist).

## Acceptance
Add creates a correct expense; Remove targets the newest match and confirms when documented; added-state survives refresh and is case-insensitive; salaries flow (all staff, one click each) takes under a minute.

---

## Claude Design prompt

```
Design the RECURRING ITEMS screen inside the app chrome (month "March 2026", Recurring tab
active).

h1 "Recurring Items", subtext "Vendors and salaries billed every month. Nothing is added
automatically — confirm each one you want to add to March 2026."

Table with uppercase headers: Name | Amount | Line Item | (blank action column). Rows:

Quincy Smith      $9,211.50  Salary                   [Added to March 2026 ✓ + quiet "Remove"]
Misty Smith       $7,596.16  Salary                   [Added to March 2026 ✓ + quiet "Remove"]
Cornelius Webb    $5,000.00  Salary                   [Added to March 2026 ✓ + quiet "Remove"]
Tabitha Figueroa  $5,416.70  Salary                   [secondary button "Add to Mar"]
Google Workspace  $504.00    Promotional & Marketing  [secondary button "Add to Mar"]
ClickUp           $439.00    Promotional & Marketing  [secondary button "Add to Mar"]
Adobe             $99.99     Analytical Support       [Added to March 2026 ✓ + quiet "Remove"]
Zoom              $29.51     Promotional & Marketing  [secondary button "Add to Mar"]
Hiscox            $93.00     Analytical Support       [secondary button "Add to Mar"]

Below the last row, a quiet indicator row: "… 5 more salary rows" in #5B5147 italic.

"Added to March 2026" in green #2F4F3E bold 14px with a small check, "Remove" as a bordered
quiet chip. Give the CORNELIUS WEBB row a faint green flash background (#EAF3EC) as the
just-added state (he was added seconds ago and has no documents yet). Each row also has a
quiet "Edit" link before the action.

Below the table: secondary button "+ Add recurring item", and ALSO show the open inline form
variant (bordered white card): three fields side by side — Name, Amount, Line item select —
plus optional "Default description" input underneath, buttons primary "Add recurring item" +
secondary "Cancel", and an example error in red: "Enter a name, an amount, and a line item."
```
