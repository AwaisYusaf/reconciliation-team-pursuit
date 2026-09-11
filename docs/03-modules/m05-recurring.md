# m05 — Recurring Items

## Purpose
The fixed monthly set — software subscriptions and salaries — added to a month in clicks instead of re-typed. Nothing is ever automatic (R8.3).

## Scope
Route `/r/recurring`. Managed list (CRUD) + per-row "Add to {month}" with added-state and undo.

## Data
Reads/writes `recurring_items`; creates `expenses` (no documents — R4.5). A recurring item belongs to a funding source **through its line item** (spec §4) — it has no `funding_source_id` column of its own. Added detection: an expense exists in the active month with the same name (case-insensitive) + line item.

## Behavior
- Table: `Name | Amount | Line Item | [Funding Source] | (action)` — the Funding Source column (resolved via the line item) appears only when the org has more than one source (D-93). Action: secondary `Add to {Mon}` → creates an expense (month = active month, date = today per R2.5, payment source = the template's own source when it is still active, else the org's first active one, **tax/fees = the line item's funding source's rules** (D-93 — no longer the payment source's), description = the template's or the vendor-library default, narrative = the template's). The row flashes green and becomes `Added to {Month}` + quiet `Remove`. The flash waits for the add to succeed — it used to fire first, so a failed add still went green, which is how a live insert failure stayed invisible on this screen.
- **Remove** deletes the newest expense this item actually created (tracked by `recurring_item_id`); if that expense has ≥ 1 document attached, a confirm dialog is required first (R8.3). An expense that only matches by name and line item — typed in by hand, never created by this item — is shown as `Added` for information but is refused outright by Remove, no confirmation offered; the error names the expense and points to the Expenses list instead (D-79).
- Subtext: `Vendors and salaries billed every month. Nothing is added automatically — confirm each one you want to add to {Month YYYY}.`
- `+ Add recurring item` inline form: name, amount, line item, optional description. Edit/delete per row (delete = list only, never touches expenses). Recurring items are cascade-deleted with their line item after the R9.3 confirm.
- **Search, line item filter, pagination.** Search matches name and default description; the
  filter offers only line items that actually have a recurring item, so a chosen filter can never
  show an empty table. 25 rows per page, and the pager appears only above that — a short list
  stays one uninterrupted table. Any filter change returns to page 1, and the page is clamped at
  render so deleting the last row of the last page cannot strand the reader on a page that no
  longer exists. Saving an item the current search or filter would hide clears the controls, so a
  save never looks like it failed. The list and that save check share one predicate,
  `matchesRecurringFilters`.
  - Added-state is unaffected: it is resolved per row on the server from the whole month, so it
    travels with the row and stays correct on any page or filter. Narrowing the *lookup* instead
    would make a filtered row read as not-added, and adding again would duplicate a salary.
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
variant (bordered white card): three fields side by side — Name, Amount, Line item select — then Default description, Default narrative (textarea), and a row of Payment source / Tax / Fees. Everything but the first three is optional; narrative is the field that stops last month being reopened to copy text (R8.3, D-66) —
plus optional "Default description" input underneath, buttons primary "Add recurring item" +
secondary "Cancel", and an example error in red: "Enter a name, an amount, and a line item."
```
