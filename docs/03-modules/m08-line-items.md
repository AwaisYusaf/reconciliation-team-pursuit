# m08 — Line Items

## Purpose
Manage the funder-approved budget categories that everything hangs off.

## Scope
Route `/r/line-items`. List + inline edit (name, scheduled value, opening previously-billed) + add + delete + reorder.

## Data
`line_items` CRUD + `line_item_performances` (R9.5). Rules R9.1–R9.5 (rename cascade, delete block, performances), R3.1 (opening balance).

## Behavior
- Table: `Line Item Name | Scheduled Value | Performances | Opening Previously Billed | Actions (Edit · Add · Delete)`; drag-handle or up/down for `sort_order` (drives cover sheet/packet/summary order). Scheduled Value shown is the **effective** total (base + every performance, R9.5) — the same number every other screen and document reads. Performances is that total's performance-only slice (`—` when none), so the added amount is visible without opening the popup.
- Inline edit row: name + both money fields + Save/Cancel. The Scheduled Value field here is the **base** value only, labeled "Base value only" beneath it — performances are managed separately (below), and without that label the field looks like it's editing the same number the column shows, which on a line item that is all performance starts from 0.00 and would double the budget if the column's own total were typed back in. Rename cascades silently (R9.2).
- `Add` opens a popup for that line item (`Modal`, not the destructive-confirm `Dialog`): shows the base value, each performance numbered "Performance 1", "Performance 2", … with a Delete beside each — which asks for confirmation first, naming the amount and the line item, before removing it — then the combined **Total**, then a money input + "Add performance" button. Performances have no label or date — an amount only.
- Delete blocked with exact message (R9.3/R12) when referenced by any expense in any month. Deleting an unreferenced line item that has recurring items and/or performances shows a confirm dialog naming both ("Deleting also removes {amount} of added performances and {n} recurring item(s): {names}") and cascade-deletes them (R9.3, R9.5).
- `+ Add line item` inline form: name + scheduled value (+ optional opening billed). Duplicate name error: `A line item with that name already exists.`
- Helper text explains opening balance: "Amount already billed against this line item before you started using this system. Used in Previously Billed math."

## Server surface
`saveLineItem` (create/update, rename cascades), `deleteLineItem` (expense-blocked; recurring + performance cascade confirm), `reorderLineItems(orderedIds)`, `addLineItemPerformance(lineItemId, amount)`, `deleteLineItemPerformance(id)`.

## Acceptance
Rename updates historical expenses/vendor defaults/recurring/filters; delete blocks on expenses and cascade-confirms on recurring and performances; reorder changes packet/cover-sheet/summary ordering; opening balance flows into R3.1 everywhere; adding or removing a performance updates Scheduled Value everywhere it is read (this screen, dashboard, Contract Summary, packet, Excel) without any of those needing their own change; the system handles **15+ line items** cleanly (SOW §2 capacity — dashboard, summary table/Excel, packet sections, and selectors all render and paginate correctly at that scale).

---

## Claude Design prompt

```
Design the LINE ITEMS screen inside the app chrome (Line Items tab active).

h1 "Line Items", subtext "Budget line items used across the dashboard, expenses, cover
sheets, and packet. Order here controls their order in documents."

Table with uppercase headers: (drag handle column) | Line Item Name | Scheduled Value |
Performances | Opening Previously Billed | Actions. Rows (money right-aligned, quiet ⋮⋮ drag
handle at left; Performances is "—" when a line item has none):

Salary                      $483,692.46  $25,000.00  $350,000.00   Edit · Add · Delete
Analytical Support          $66,929.14   —           $40,000.00    Edit · Add · Delete
Promotional & Marketing     $58,212.62   —           $48,198.51    Edit · Add · Delete
Social Services & Support   $41,250.00   —           $30,000.00    Edit · Add · Delete
Community Programs & Events $39,832.45   —           $13,985.96    Edit · Add · Delete
Professional Development    $15,000.00   —           $1,749.00     Edit · Add · Delete

Render the "Social Services & Support" row in its INLINE EDIT state instead: name text input,
two money inputs, and secondary "Save" + quiet "Cancel" buttons in the actions cell.

Below the table, red error text example: ""Salary" has expenses recorded against it and
cannot be deleted."

Then secondary button "+ Add line item", and ALSO the open add form variant (bordered card):
"Line item name" input + "Scheduled value" money input + "Opening previously billed
(optional)" money input with helper text "Amount already billed before you started using this
system." Buttons: primary "Add line item" + secondary "Cancel".

Also render, as a separate frame, the ADD PERFORMANCE popup opened by clicking "Add" on the
"Salary" row: a centered modal (neutral surface, not the red destructive-confirm style), title
"Salary — Performances", an × close button top-right. Body: row "Base value" right-aligned
"$458,692.46"; row "Performance 1" right-aligned "$25,000.00" with a quiet "Delete" beside
it; a hairline; bold row "Total" right-aligned "$483,692.46"; then a money input labeled "Add
performance" and a primary "Add performance" button.
```
