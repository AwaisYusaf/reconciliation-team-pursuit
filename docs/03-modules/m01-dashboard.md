# m01 — Dashboard

## Purpose
Month-at-a-glance budget health per line item; the screen staff live on between entries.

## Scope
Route `/r` (authenticated). One `SourceBudgetSection` per funding source shown, each a table of line items with derived figures for the active month; low-budget emphasis; primary actions to Add Expense and Month-End Packet.

## Data
Per source: reads that source's `line_items` + calculation service (R3.1–R3.6). No writes.

## Behavior
- **Per-source sections (Phase 5, D-93).** One source selected (or a single-source org): one section, titled with the source name only when the org has more than one source — a single-source org sees exactly what it saw before this feature. With "All" selected: one section per **active** funding source, in `sort_order`, each with its own approved/spent/remaining cards, its own drift notice and its own line-item table. **There is no combined total across sources, anywhere** — different funders' money is not one budget (Appendix A §5).
- **Two views per section, never one table (R3.8).** A grant strip at the top — Original approved budget / Total spent to date / Total remaining, cumulative and with no month in it. Below it the month on its own: `Line Item | Opening Balance | Spent in {Mon} | Closing Balance`, which reconciles by subtraction and opens where the previous month closed (R3 definitions; money per R1.2).
- When the month has been submitted for a source and its figures have since changed, that section's notice names every category that moved and by how much (R3.9), scoped to that source's own submitted snapshot only. The submitted packet is unchanged and still downloadable; both figures are true.
- Remaining cell when `remaining/budget < 0.10`: bold `#8A2A22` on `#F6E7E4` (R3.6). Negative remaining shows the same treatment.
- Page subtext: `Budget status for {Month YYYY}.` Per-section buttons: primary `Add Expense`, secondary `View Month-End Packet` (with "All", `/r/packet` asks the visitor to pick a source).
- First-run banner + empty state come from m00; the welcome banner stays page-level, not per section, and shows only while the person has not dismissed it and the organization has no expense at all (usability #52).
- **Greeting (usability #17, 2026-09-29).** The page title reads `Welcome, {first name}!` (`Welcome!` with no name) for everyone, returning users included; "Welcome back" is the sign-in screen's wording only.
- **AI note (usability #56).** On an organization whose plan includes AI (`aiAllowedForOrg`, plan and billing only, so it shows even with the reading switch off), one line inside the first-run welcome banner says what AI does and where: shown only while that banner shows (not dismissed, no expense yet), never as a separate tile on every visit (user review 2026-09-29). While AI reading is on (`readAmountsAllowedForOrg`: the Settings switch and the server's OpenAI setup) it is `UI.dashboardAiIntro` (receipt amounts, invoices, the monthly summary); with reading off it is the shorter `UI.dashboardAiIntroSummaryOnly`, `Your plan includes AI. It writes your monthly summary on the Month-End Packet page.` Base plan: nothing.
- **Drafts waiting for review (usability #64, PHASE-14 C12).** Each section with drafts in the active month shows a calm card titled `{N} drafts waiting for review · {total}` with the line `They aren't in your totals or the packet until you approve them.` (singular for one), and a `Review drafts` link to `/r/expenses?view=drafts` (with `&source=` when the header is on All). The total is the drafts' reimbursable sum, the same figure each draft row shows. When that source's month is locked, approving is refused (R10.7), so the note says `{Month YYYY} is locked, so they can't be approved until the month is unlocked.` instead of promising approval. Nothing when there are none. Drafts still count in no figure on this screen (PHASE-14 §6); the note only reports them.
- **Recent expenses wrap (usability #53).** Long names and the line-item/date line wrap inside their row instead of being cut off; the card still never widens the page.
- **Monthly summary ready link (Phase 11 §7.5).** On Reconciliation + AI, once a summary exists for that source's active month, a quiet `Monthly summary ready` link follows the two buttons. From "All" (or another source's section) it first switches the header's active funding source, then opens `/r/monthly-summary`, since that screen follows the header. Base plan or no summary for the month: nothing shown.

## Server surface
`loadSourceBudget(orgId, fundingSourceId, month)` (`src/modules/dashboard/queries.ts`): dashboard rows for one (org, source, month). Called once per section shown.
`loadReadySummarySourceIds(orgId, sourceIds, month)` (`src/modules/monthly-summary/queries.ts`): one query for every section shown, not one per source.

## Acceptance
Figures match Excel sheet 1 for the same data (R10.2); switching month re-renders instantly; low-budget styling triggers at exactly <10%.

---

## Claude Design prompt

```
Design the DASHBOARD screen inside the app chrome (org "Team Pursuit Global", month
"February 2026", Dashboard tab active).

Content: h1 "Dashboard", subtext "Budget status for February 2026." Then a full-width table
in a bordered card with uppercase column headers: Line Item | Opening Balance |
Spent in {Mon} | Closing Balance, above it a three-card grant strip (approved / spent to
date / remaining). All money right-aligned, $1,234.56 format. Rows:

Salary                      $458,692.46   $45,641.12   $395,641.12   $63,051.34
Analytical Support          $66,929.14    $19,890.83   $59,890.83    $7,038.31
Promotional & Marketing     $58,212.62    $11,851.65   $60,050.16    -$1,837.54  ← OVER
Social Services & Support   $41,250.00    $10,231.08   $40,231.08    $1,018.92   ← LOW
Community Programs & Events $39,832.45    $4,251.28    $18,237.24    $21,595.21
Professional Development    $15,000.00    $1,599.00    $3,348.00     $11,652.00

For the two flagged rows only, render the Remaining cell in bold #8A2A22 on a #F6E7E4 cell
background (the "-$1,837.54" one too). Every other cell normal (Analytical Support's
$7,038.31 is 10.5% remaining — above the 10% warning threshold, so it stays unstyled).

Below the table: primary button "Add Expense" and secondary button "View Month-End Packet".
Keep it exactly this simple — no charts, no KPI cards; this screen is a budget table that
non-technical nonprofit staff read at a glance.
```
