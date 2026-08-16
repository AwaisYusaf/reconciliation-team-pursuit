# m08 — Line Items

## Purpose
Manage the funder-approved budget categories that everything hangs off.

## Scope
Route `/line-items`. List + inline edit (name, scheduled value, opening previously-billed) + add + delete + reorder.

## Data
`line_items` CRUD. Rules R9.1–R9.4 (rename cascade, delete block), R3.1 (opening balance).

## Behavior
- Table: `Line Item Name | Scheduled Value | Opening Previously Billed | Actions (Edit · Delete)`; drag-handle or up/down for `sort_order` (drives cover sheet/packet/summary order).
- Inline edit row: name + both money fields + Save/Cancel. Rename cascades silently (R9.2).
- Delete blocked with exact message (R9.3/R12) when referenced by any expense in any month. Deleting an unreferenced line item that has recurring items shows a confirm dialog listing them ("Deleting also removes {n} recurring item(s): {names}") and cascade-deletes them (R9.3).
- `+ Add line item` inline form: name + scheduled value (+ optional opening billed). Duplicate name error: `A line item with that name already exists.`
- Helper text explains opening balance: "Amount already billed against this line item before you started using this system. Used in Previously Billed math."

## Server surface
`saveLineItem` (create/update, rename cascades), `deleteLineItem` (expense-blocked; recurring cascade confirm), `reorderLineItems(orderedIds)`.

## Acceptance
Rename updates historical expenses/vendor defaults/recurring/filters; delete blocks on expenses and cascade-confirms on recurring; reorder changes packet/cover-sheet/summary ordering; opening balance flows into R3.1 everywhere; the system handles **15+ line items** cleanly (SOW §2 capacity — dashboard, summary table/Excel, packet sections, and selectors all render and paginate correctly at that scale).

---

## Claude Design prompt

```
Design the LINE ITEMS screen inside the app chrome (Line Items tab active).

h1 "Line Items", subtext "Budget line items used across the dashboard, expenses, cover
sheets, and packet. Order here controls their order in documents."

Table with uppercase headers: (drag handle column) | Line Item Name | Scheduled Value |
Opening Previously Billed | Actions. Rows (money right-aligned, quiet ⋮⋮ drag handle at left):

Salary                      $458,692.46  $350,000.00   Edit · Delete
Analytical Support          $66,929.14   $40,000.00    Edit · Delete
Promotional & Marketing     $58,212.62   $48,198.51    Edit · Delete
Social Services & Support   $41,250.00   $30,000.00    Edit · Delete
Community Programs & Events $39,832.45   $13,985.96    Edit · Delete
Professional Development    $15,000.00   $1,749.00     Edit · Delete

Render the "Social Services & Support" row in its INLINE EDIT state instead: name text input,
two money inputs, and secondary "Save" + quiet "Cancel" buttons in the actions cell.

Below the table, red error text example: ""Salary" has expenses recorded against it and
cannot be deleted."

Then secondary button "+ Add line item", and ALSO the open add form variant (bordered card):
"Line item name" input + "Scheduled value" money input + "Opening previously billed
(optional)" money input with helper text "Amount already billed before you started using this
system." Buttons: primary "Add line item" + secondary "Cancel".
```
