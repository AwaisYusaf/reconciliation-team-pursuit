# Stay Funded 360 — UI Redesign Brief

Everything a designer needs to rebuild this app's interface: what the product is, who uses it,
every screen's content, and the colour and type system it is built on.

Written from the code on `feat/upload-invoices`, 2026-09-23. Where the older module specs in
`docs/03-modules/` disagree with the code, this file follows the **code** and the drift is
listed in §14.

---

## 1. What the product is

**Stay Funded 360** is a private internal tool for **Team Pursuit Global**, a Detroit nonprofit
that bills the City of Detroit monthly for grant reimbursement through a fiduciary (Detroit
Crime Commission).

Every month they submit a packet of roughly 130 pages: a cover sheet per budget line, an Excel
contract summary, every receipt, every proof of payment, bank statements and timesheets. It
used to be assembled by hand over two to three working days, and it came back rejected for
totals that did not reconcile, missing receipts found at submission, and format drift.

The app's whole bet is this: **capture each expense once, at the moment it happens, with its
documents attached** — then generate the entire packet in minutes, internally consistent by
construction, in the format the City already accepts.

### Who uses it

| Who | Context |
|---|---|
| Two org staff (a program manager and a director) | Non-technical. Laptop and phone. They enter expenses, upload documents, download the outputs. |
| Fiduciary and City reviewers | **Never log in.** They only receive the generated packet and workbook, so the *outputs* must look familiar to them. |
| AB Solutions staff | A separate admin area at `/a` for the people who run the platform. |

### The monthly cycle

1. **During the month** each purchase is entered when it happens, with its receipt and proof of
   payment. A vendor library autofills from the last time that payee was used. Recurring items
   (salaries, subscriptions) are added in one click.
2. **Month end**: upload the month-level documents. The Packet screen shows per line item
   readiness and a blocking list naming every record still missing a proof, a receipt or a
   narrative, each with a jump-to-fix link.
3. **When nothing is missing**: download the packet PDF and the summary workbook, plus per line
   item cover sheets as Word and PDF.
4. **Submission** happens outside the system: the org uploads the packet to DocuSign.

### Core vocabulary (use these words, one name per thing)

| Term | Meaning |
|---|---|
| **Month** | The reporting period, e.g. `2026-02`. Every expense belongs to exactly one. The header selector switches the whole app. |
| **Funding source** | A grant. An org can hold several; their line items, expenses and packets never mix. |
| **Line item** | A funder-approved budget category with a scheduled value and an opening previously-billed balance. |
| **Expense** | One row on a cover sheet. Name = payee or label, description = the "Role" column text, amount = the reimbursable part. |
| **Proof of payment** | Evidence money moved: bank transaction crops, payment screenshots. Always required. |
| **Receipt / justification** | What was owed: receipt, invoice or timesheet. Required unless "no receipt available" plus a reason, which then prints on the cover sheet. |
| **Supporting document** | Typed extra evidence: check copy, request form, vendor invoice, event flyer, narrative, other. |
| **Month document** | Packet-level, not tied to one expense: bank statement, timesheet, combined hours, fiduciary invoice, other. |
| **Packet** | The merged, ordered, page-numbered PDF for one month and one funding source. |
| **Draft** | A charge read off an invoice that is waiting for a person to check it. Counts in nothing until approved. |

### The aesthetic, and why

Quiet, paper-like, **government-document adjacent**. It should feel like well-organised
paperwork: trustworthy, legible, unhurried. No gradients, no glassmorphism, no illustrations,
no emoji, no rounded-bubble SaaS styling. The people using it are not designers and are often
in a hurry at month end; the documents it produces go to a city reviewer.

There is exactly **one** gradient in the whole app, on the "Plus" plan badge, and it is a
deliberate exception so the AI tier reads as a product tier.

---

## 2. Colour

These are Tailwind 4 `@theme` tokens in `app/globals.css`. This is the set the app uses.

| Token | Hex | Use |
|---|---|---|
| `paper` | `#FBF9F5` | Page background, warm paper |
| `surface` | `#FFFFFF` | Cards, tables, header bar, inputs, modals |
| `ink` | `#211B16` | Primary text; the 2px rule under table headers |
| `sub` | `#5B5147` | Secondary text, labels, column headers, helper text |
| `line` | `#D8D0C4` | Every hairline border and divider |
| `accent` | `#5B3A29` | Deep brown: primary buttons, links, active tab underline, focus ring |
| `accent-dark` | `#3E2719` | Hover on accent |
| `danger` | `#8A2A22` | Error text, destructive borders, the word MISSING |
| `danger-bg` | `#F6E7E4` | Error panel wash |
| `caution` | `#8A5A12` | A heads-up, deliberately distinct from danger so it does not read as a hard error |
| `success` | `#2F4F3E` | Saved ticks, complete states |
| `success-bg` | `#EAF3EC` | Success wash, just-changed row flash |
| `section` | `#F1ECE2` | Table section bands, hover fills, disabled input fill |
| `autofill` | `#F3E9DD` | Vendor autofill tint, AI suggestion panels |
| `disabled` | `#C9C2B4` | Disabled fills, switch off-track |
| `disabled-ink` | `#7A7364` | Disabled text |
| `placeholder` | `#8C8177` | Input placeholders |
| `diff-added` | `#BFE6CD` | Inline audit-trail highlight, added words |
| `diff-removed` | `#F3C8C2` | Inline audit-trail highlight, removed words |
| `doc-yellow` | `#FFFF00` | **Only** inside previews that mimic the real submission documents (header rows, total cells). Never app chrome. |
| `plus-light` | `#94603F` | Caramel start of the Plus badge gradient |

Shadows exist only on modals, dropdown menus and the tour card. Cards and tables have **no
shadow**: a 1px `line` border and a 4px radius, nothing more.

Focus is one global rule: `2px solid accent`, `2px` offset. There is no per-component focus
styling except where a panel would clip the outline, in which case it is inset.

### Known token bug

`text-muted` is used at **28 call sites** but `--color-muted` does not exist in the theme.
Tailwind 4 generates utilities only from tokens, so those elements render with no colour of
their own and inherit the parent's. Affected places include the modal close button and several
admin tiles. A redesign should either define the token or map those to `sub`.

---

## 3. Type

| Role | Face | Phone | Tablet | Desktop |
|---|---|---|---|---|
| Page title (h1) | Georgia bold | 22px | 24px | 28px |
| Section title (h2) | Georgia bold | 18px | 20px | 20px |
| Subsection (h3) | Georgia bold | 16px | 17px | 17px |
| Subtext / body | Arial | 15px | 16px | 16px |
| Table cell | Arial | 15px | 16px | 16px |
| Column header | Arial bold | 13px uppercase, letter-spacing 0.06em, `sub` | | |
| Eyebrow | Arial bold | 13px uppercase, letter-spacing 0.1em, `sub` | | |
| Org name (header) | Georgia bold | 18px | 20px | 24px |

- Headings: `Georgia, "Times New Roman", serif`
- Everything else: `Arial, Helvetica, sans-serif`
- Document previews: `Aptos, Calibri, "Segoe UI", Arial, sans-serif`, to match the generated
  Word file

**Money is always right-aligned with tabular numerals**, formatted `$1,234.56`, negatives
leading with the sign.

Every heading comes from its primitive (`PageTitle`, `SectionTitle`, `SubsectionTitle`). A
screen that writes its own `text-[28px]` is treated as a bug, because three screens once
quietly ended up with a non-bold h2 that way.

---

## 4. Controls and layout

**Buttons**, radius 3px:

| Variant | Height | Look |
|---|---|---|
| `primary` | 48px, padding-inline 22px | Accent fill, white bold 16px. Hover `accent-dark`. |
| `secondary` | 48px, padding-inline 18px | White fill, 1px accent border, accent bold 16px. Hover fill `section`. |
| `quiet` | 44px | Underlined accent text link, 15px. Hover `accent-dark`. |

Disabled buttons go `disabled` fill on `disabled-ink` text with `cursor: not-allowed`. There is
**no spinner anywhere** in the app; a pending control either swaps its label ("Saving…",
"Preparing the packet…") or simply disables.

**Inputs**: min-height 44px, padding 12px vertical / 14px horizontal, 16px text, white fill, 1px
`line` border, 3px radius. Labels sit above at 15px semibold. Disabled inputs take a `section`
fill so a locked month's expense does not look editable. Money inputs are a bordered composite
with a leading `$` and a right-aligned tabular field.

**Tables**: white card, 4px radius, 1px border. Header row is 13px uppercase `sub` over a **2px
`ink` bottom border**. Rows divide with 1px `line`. Cells 12–16px padding. Wide tables scroll
**inside their card**, never the page, and pin their first and last columns until 1280px so a
row stays identifiable while scrolling. A `dense` option drops cell padding to 10px and header
type to 11px for tables that would otherwise overflow.

**Empty states**: a dashed 1px `line` box, 40–56px vertical padding, centred `sub` text.

**Error panels** have two tones: `blocking` (2px danger border, serif bold title, used when
something is genuinely prevented) and `notice` (1px border, 15px bold title, used for a
heads-up).

**Layout**: content max-width **1220px**, centred. Page gutters 16px → 24px. Card padding
16/20/24px. Main vertical rhythm 24→32px top, 48→64px bottom. Breakpoints in use are Tailwind's
`sm:` (640), `lg:` (1024) and `xl:` (1280); `md:` is essentially unused. The documented
convention is "phone value, then `sm:`, then `lg:`".

**Icons**: there is no icon library. Everything is a hand-rolled inline SVG on a `0 0 20 20`
viewBox, sized `w-4 h-4`, or a unicode glyph: `⋮` for row actions, `×` for modal close, `✓` for
saved, `-` for an empty cell. There are no arrow glyphs anywhere.

---

## 5. The app shell

Wraps every `/r/*` screen. Three rows, then the page.

**Row 1**, white with a bottom border: organisation name in Georgia bold 18/20/24px, truncated
rather than wrapped so a long name cannot push the sign-out button onto its own line. Beneath
it the brand lockup (mark then wordmark). On the right: a **Plus** badge when the org is on the
`reconciliation_ai` plan; a 44×44 tour-replay target containing a 28px circle with a serif
italic **i**, titled "Show this screen's walkthrough again"; then **Sign out** (secondary).

**Row 2**, white, deliberately **no** bottom border (a line here made two white boxes read as
separate stacked bars):

- **Month** select, 200px. Options grouped by year, newest first, labelled `February 2026`. The
  last option is **"Other month…"**, which reveals a native month input plus a Cancel link.
- **Funding source** select, 220px. "All funding sources" first, then active sources, then an
  `Archived` group. **Only rendered when the org has more than one source.**

**Row 3**, sticky at the top, white, bottom border. Nine tabs in this exact order:

`Dashboard · Add Expense · Expenses · Cover Sheets · Recurring · Month-End Packet · Contract
Summary · Line Items · Settings`

Active tab: bold `ink` with a 3px `accent` bottom border. Inactive: `sub`, transparent border.
The row **scrolls horizontally** below 1024px and never wraps — nine links wrapped onto four
ragged rows once made the header 545px tall on an 812px phone. The scrollbar is hidden, the row
bleeds to the screen edges so a half-visible tab signals "more this way", and the active tab is
scrolled into view on load.

**There is no footer.** A toast host sits at the end of the shell; toasts appear bottom-centre,
white with a 1px border, 15px text, 4 seconds (6 for errors, 8 when they carry an Undo).

---

## 6. Dashboard — `/r`

Shows, for the chosen month, how much of each budget line is left.

- h1 **"Dashboard"**, subtext **"Budget status for {Month YYYY}."**
- **Welcome banner** until dismissed: "Your budget is set up. Add your first expense to get
  started." with **Add Expense** (primary) and **Dismiss** (quiet).
- Then **one section per funding source**. With one source selected, one section. On "All", one
  per active source. **There is no combined total anywhere** — grants are never mixed.
- Per section:
  - Source name as a heading, only when the org has more than one source.
  - **Drift notice** (notice tone) when the month was submitted and figures have moved since:
    "{Month YYYY} has changed since it was submitted." then "The packet that was sent is
    unchanged and still downloadable. These line items now differ from it:" then per line item
    `Opening balance: submitted at $X, now $Y (+$Z)`.
  - **Three stat cards**: "Original approved budget", "Total spent to date", "Total remaining".
    13px uppercase label over 24px bold tabular money. Total remaining turns red when negative.
    Below them: "These totals cover this funding source to date, across every month: {NN}% of
    the approved budget is committed."
  - Sub-heading **"{Month YYYY} on its own"** with "Opening balance, what this month spent, and
    what is left at the end of it. Each month starts where the last one closed."
  - **Table** (min 760): `Line Item | Opening Balance | Spent in {Mon} | Closing Balance`. Last
    three right-aligned tabular. Closing Balance goes **bold red on a soft red background** when
    the line is near exhausted or overspent.
  - Buttons: **Add Expense** (primary), **View Month-End Packet** (secondary), and **"Monthly
    summary ready"** (quiet) only when a summary exists.
- Empty: "No active funding sources. Add one in Settings." / "No line items yet. Set up your
  budget in Line Items."

---

## 7. Expenses — `/r/expenses`

Everything recorded for the month, what each one is still missing, and the way into editing.

- h1 **"Expenses this month"**, subtext the month label.
- **Other-month notice** when the URL month differs from the active one: "This is the month you
  last saved to, not your active month ({Month YYYY}). Go to your active month."
- **Toolbar, right**: **"Waiting for review (N)"** (secondary link, only when the month has
  drafts; label flips to **"Back to expenses"** on the drafts view), then **Trash** (secondary,
  with an inline trash-can SVG).

**Only one list is on screen at a time.** `?view=drafts` swaps the table; it is never stacked.

### 7a. The expenses table

- **Summary cards**: one per payment source, or per funding source when the scope is "All".
  13px muted label over 20px bold money. They always total the whole month, never the filtered
  subset.
- **Incomplete strip** (notice) when any row is incomplete: "{n} expenses are missing
  documentation. **Show only those** / **Show all expenses** or **go to the Month-End Packet**."
- **Six filters**, each 240–340px:
  1. **Search** — placeholder "Reference, name or description".
  2. **Sort by** — Date (newest first) · Date (oldest first) · **Reference** (default) · Name (A
     to Z) · Name (Z to A) · Amount (highest first) · Amount (lowest first).
  3. **Filter by line item** — "All line items" plus each name present.
  4. **Filter by documentation** — All expenses · Missing documentation · Missing proof of
     payment · Missing receipt/justification · Missing narrative.
  5. **Filter by payment source** — "All payment sources" plus active labels.
  6. **Filter by funding source** — only on a multi-source org with the header on "All". This
     one navigates rather than filtering client-side.
- **Table**, dense, min-width 1160 with the funding source column and 1060 without:

  `Ref / Date | Name | Line item | [Funding source] | Payment source | Amount | Proof | Receipt | Supporting | Narrative | ⋮`

  - **Ref / Date** is sticky. The reference `2026-02-014` renders as an underlined button that
    opens a document viewer over every file attached to that expense, or as plain muted text
    when nothing is attached. The date `3/2/2026` sits beneath it, muted.
  - **Funding source** only when multi-source, truncated at 132px with the full name on hover.
  - **Amount** right-aligned tabular: the reimbursable amount.
  - **Proof** and **Receipt**: a thumbnail of the first file plus an underlined count opening a
    viewer, or **bold red MISSING**. Receipt instead shows italic muted "No receipt (reason)"
    when the expense is flagged as having none.
  - **Supporting**: an underlined count, or `-`.
  - **Narrative**: muted "Provided", or **bold red MISSING**.
  - **⋮** menu labelled "Actions for {reference}": **Edit**, **Delete**, and **History** for
    admins only. Delete is disabled on a locked month with the locked sentence beneath it.
- Empty: "No expenses recorded for {Month YYYY} yet." / "No expenses match these filters."
- Dialogs: **"Move this expense to the trash?"** — "{name} ({amount}) moves to the trash with
  its files and can be restored." Buttons **Keep it** / **Move to trash**. And the **history
  modal** (admin, large): `{reference} · {name}`, table `Date and time | User | Action`, with a
  **View changes** button per row leading to a diff view with inline added/removed highlighting.

### 7b. Drafts view — `?view=drafts`

- h2 **"Waiting for review (N)"**. Right: **"Approve all ready (N)"** (primary) or, when nothing
  is ready, the plain sentence **"No draft has everything it needs yet."** rendered as visible
  text, never as a tooltip on a disabled button.
- **Table**, dense: `Date | Name | Line item | [Funding source] | Payment source | Amount | Still needs | ⋮`
  - **Date** sticky, with a small uppercase **Draft** mark above the date.
  - **Name** is an underlined link straight to the edit screen.
  - **Still needs** joins what is missing with ` · `: "Needs a line item", "Needs a narrative".
    `-` when ready.
  - **Approve** (secondary) shows only when the row is ready; the **⋮** menu holds **Edit** and
    **Discard**.
  - **Proof, Receipt, Supporting and Narrative columns are deliberately absent** — a draft is in
    no gate and no packet, so a red MISSING would name a blocker that does not exist yet.
- **Discard** asks first: "Discard this draft?" — "{name} will be removed. It does not go to
  Trash, and any files attached to it are deleted. Undo brings the charge back, but not its
  files." Buttons **Keep it** / **Discard**.
- Toasts carry an **Undo**: "Draft discarded." or "Draft discarded. Its attached files were
  removed too." Bulk approve reports "{n} expenses approved. {m} still need your attention."
- The view falls back to the expenses table the moment the month has no drafts left, so nobody
  is stranded on an empty screen whose way back has just disappeared.

---

## 8. Add Expense — `/r/expenses/new`

- h1 **"Add Expense"**, subtext "Enter one expense for {Month YYYY}. It will appear on the
  Expenses list and the matching cover sheet right away."
- On the right, stacked: a **Funding source** select (only when the header is on "All" or holds
  an archived source), and **"Extract From Invoice"** (secondary), whose label becomes
  **"Reading the invoice…"** while the read runs. It accepts PDF, JPEG, PNG, WebP and HEIC, and
  is disabled on a locked month with the locked sentence beneath.
- **On the base plan neither control exists** and the screen is exactly the heading plus the
  form.

### 8a. The invoice check screen

Replaces the whole page once a read succeeds. Max-width 720px.

1. **"Invoice date: 3/18/2026"** when a date was read.
2. Up to four notice panels, in order, each conditional:
   - "This invoice was already added on {date} by {name}. Adding it again will create these
     expenses a second time."
   - "This invoice has more than 50 lines. The first 50 were read. Add the rest by hand."
   - "{n} charges on this invoice could not be read and are not shown. Add them by hand."
   - "This invoice charges {amount} on the whole bill, not on any one line. It is not included
     in the drafts below. Add it as its own expense if it belongs in this month."
3. **One card per charge read.** The summary row is the whole expand control: a chevron that
   rotates 90° when open, the charge name in bold (or "Untitled charge"), the subtotal, and once
   marked a pill reading **"Saving as expense"** or **"Saving as draft"**. When closed and still
   incomplete, a 13px muted line lists what it needs. Every card has **Remove** (quiet).
   Expanding reveals a full expense form with **"Save as expense"** (primary) and **"Mark as
   draft"** (secondary); the invoice appears under the receipt field as a chip with an **Open**
   link.
4. **Marking a card writes nothing.** The screen only records intent; everything is written when
   **Done** is pressed.
5. Footer: **Done** (primary, label becomes "Saving the charges…") and **Back** (quiet).
6. Dialogs: "Remove this charge from the screen?" and "Leave without saving every charge?"
   ("{n} charges have not been marked yet. Going back reads nothing into the month, and the
   invoice would have to be read again.")
7. **A read survives a page reload**, scoped to that month and funding source, and is cleared
   once Done succeeds.

### 8b. The expense form

Shared by Add, Edit, Edit draft and every invoice card. Single column, max 560px, one card with
28px padding.

Banners above the card, mutually exclusive: the **locked month** panel (blocking, whole form
disabled, no Save or Delete), or the **submitted month** notice ("{Month YYYY} was submitted on
{date}. Your changes won't alter the packet already downloaded, but documents downloaded from
now on will include them.").

Fields in order:

1. **Name** — placeholder "Vendor, person, or a short label". A suggestion dropdown opens
   beneath showing each remembered payee, a right-aligned "last $X", and a second line of
   `line item · payment source · description`.
2. **Funding source** — static text when the org has one; a select otherwise. Changing it clears
   the line item and re-applies that grant's tax and fee rules.
3. **Line item** — options labelled `{name} · {amount} remaining`.
4. **Payment source** — active labels; a retired label already on the record is still offered,
   suffixed " (no longer in use)".
5. **Month** and **Date** side by side (both hidden on an invoice card).
6. **Description / role (prints on the cover sheet exactly as typed)** — 2-row textarea.
7. *On the Plus plan the two upload fields move here, above the amounts.*
8. **Subtotal · Tax · Fees** — three money inputs, placeholder `0.00`.
9. **Read amounts from documents** (secondary) — Plus, edit mode, only when there is something
   to read.
10. **Amount suggestion panel** (Plus) — a gradient-framed box: "Reading N documents…", then
    "Amounts found in your documents" with a four-cell figure strip (Subtotal / Tax / Fees /
    Total paid, or "Total refunded" when negative), a per-file list, the mismatch warning
    "Receipts add up to X but proofs of payment show Y. Check the amounts before saving.", and
    **Use these amounts** / **Dismiss**.
11. **Include in reimbursement** — two checkboxes, only when tax or fees are non-zero, with the
    helper "Funders differ on what they reimburse. Whatever is left out stays on the receipt and
    is disclosed on the cover sheet."
12. **Cautions** in amber, non-blocking: "Subtotal is $0.00. Double-check this entry." and "Tax
    is more than the subtotal. Double-check this entry."
13. **Reimbursable amount** — a 2px ink-bordered box, 24px bold, with "Receipt total: $Y ($Z not
    reimbursed)" beneath when they differ.
14. **Projection** — "Remaining on {line item} after this expense: $X", bold red when negative.
15. **Proof of payment** and **Receipt / justification (receipt, invoice, or timesheet)** — each
    an upload field with **Add files** (secondary) and "PNG, JPG, HEIC or PDF, up to 25 MB. You
    can attach more than one." Attached files list with a thumbnail, filename, page count and a
    **Remove** confirm; queued files show dashed with "Uploads when you save".
16. Under the receipt field: the invoice chip, then the **No receipt available** checkbox, which
    reveals a required **"Reason (prints on the cover sheet)"** textarea and a red helper naming
    how many attached receipts saving will delete.
17. **Supporting documents** — an upload field with a document-type select above it.
18. **Note (optional)** — helper explains it prints in addition to the automatic disclosure.
19. **Narrative** — 3-row textarea, "Prints as a paragraph under this expense on the cover
    sheet."

Buttons: **Save expense** / **Save changes** (primary), **Mark as draft** (invoice cards),
**Save and approve** (draft edit), **Cancel** (quiet), **Delete** (quiet, edit only, disabled on
a locked month).

---

## 9. Edit draft — `/r/expenses/drafts/{id}/edit`

h1 **"Edit draft"**, subtext the draft's name. The same form, narrowed:

- **Funding source** and **Month** are fixed to the draft's own and render as static text.
- The receipt field carries the **invoice chip** with an **Open** link.
- The draft's own attached files are listed.
- Buttons: **Save changes** (primary), **Save and approve** (secondary), **Cancel** (quiet,
  returns to the drafts list with the month preserved). **No Delete** — Discard on the list is
  the equivalent.
- Saving toasts "Draft saved." and returns to the drafts list. Approving toasts "Approved. It
  counts in the month now." A refused approval renders in the form's red panel as "Saved, but
  not approved: {what it still needs}."

---

## 10. The remaining app screens

### Trash — `/r/expenses/trash`
h1 "Trash", subtext "Deleted expenses, across every month. Restore one, or delete it
permanently." Table (min 980): `Name | Line item | [Funding source] | Month | Amount | Files |
Deleted | ⋮` with **Restore** and **Delete permanently**, both disabled on a locked month. The
confirm names the expense and its files and says "This can't be undone." Empty: "Nothing in the
trash."

### Cover Sheets — `/r/cover-sheets`
Needs one funding source; on "All" it shows a **PickFundingSource** panel ("This screen shows
one funding source at a time. Choose one to continue.") with secondary buttons for active
sources and quiet ones under an uppercase "Archived" label.

Actions: a **Line item** select ("All line items" plus each). Per line item: a heading, a
**blocking panel** when incomplete ("This cover sheet cannot be downloaded yet." plus a row per
record with an **Open expense** link), **Download Word** and **Download PDF** (both secondary,
disabled while blocked), then the **document preview**.

The preview is the one place the design leaves its own palette: a white card set in
Aptos/Calibri, black on white, no serif. A centred bold title `{DocName} {Month YYYY} {Line
item} Breakdown`; a three-column table with black borders and **#FFFF00 header cells** (`Name |
Role | Amount` at 24% / 61% / 15%, every cell centred); a final row with a yellow bold total;
the line "Please see below for additional information for some of the above items."; then per
expense a bold `{Name} ({reference}):` heading, any notes highlighted yellow inline, the
narrative paragraph, proof images at full column width, and — on screen only — a dashed red
**"Proof of payment missing"** box where a proof is absent.

### Recurring — `/r/recurring`
h1 "Recurring items", subtext "Vendors and salaries billed every month. Nothing is added
automatically. Confirm each one you want to add to {Month YYYY}."

Filters: Search and line item. Table (min 860): `Name | Amount | Line item | [Funding source] |
⋮`. A just-changed row flashes on a green background for 2.5 seconds. Per row: **Edit** (quiet),
then either **"Add to {Mon}"** (secondary) or **"✓ Added to {Month YYYY}"** in green bold plus
**Remove**. Both are disabled on a locked month.

The add/edit form renders inline inside the row being edited: **Name**, **Amount**, **Line
item**, **Default description (optional)**, **Default narrative (optional)**, then **Payment
source / Tax / Fees** in three columns. Buttons **Add recurring item** / **Save changes**
(primary), **Cancel** (secondary), and on edit **Delete from list** (quiet) with the helper
"Deleting the list entry leaves any expenses already added untouched."

Pagination at 25 rows. Bottom: **"+ Add recurring item"** (secondary).

### Month-End Packet — `/r/packet`
The month's finish line. Needs one funding source.

Header actions are the **lock controls**: when locked, `**Reconciled** · Locked on {date} by
{name}` with **View signed packet** and **Unlock**; then the Submitted marker (**Mark as
submitted**, or "Submitted {date}" with an **Undo**); then **Lock month**, disabled while
anything is missing with red text "Add the missing documents before locking this month."

Then, top to bottom:

1. **Lock history** card: one row per event with a status dot (filled = current signed copy,
   hollow = replaced, grey = unlock), `Locked {date} by {name}` or `Unlocked {date} by {name}:
   "{reason}"`, a "Replaced on {date}" pill where applicable, and a **View signed packet** link.
2. **Blocking panel** when incomplete: "This packet cannot be downloaded yet." then "The
   following records are missing a receipt/justification, proof of payment, or narrative:" then
   a row per record with **Open expense**.
3. **Readiness table** (min 660): `Line Item | Amount This Month | Expenses | Documentation
   Complete`. The last column reads "Yes", bold red "No", or `-`. A bold **Total** row closes
   it. Every line item appears, including ones with nothing this month.
4. A two-column grid at `lg`:
   - **Packet contents** — "In the order the funder will read them." Numbered rows with page
     counts right-aligned, a bold **Total — {N} pages** row above a 2px rule, and "Page counts
     are estimated within about two pages of the final document." Then **Download packet (PDF)**
     (primary, "Preparing the packet…"), **Download summary (Excel)** (secondary), **Share
     link** (secondary). Below, the **Shared links** box: one row per shared file with its kind,
     whether it is password protected, who shared it and when, the URL in a read-only monospace
     field with **Copy link**, then **Change password** and **Stop sharing**. A notice appears
     inside the row when records have changed since sharing, with **Update shared file**.
   - **Month documents** — "Bank statements, timesheets and the fiduciary invoice for {Month
     YYYY}. These are optional and never block a download." A red reminder when no bank
     statement is attached. Groups in fixed order: **Bank statement · Combined hours · Timesheet
     · Fiduciary invoice · Other**, each an uppercase label over a bordered list with a
     **Remove** confirm. The add form is a **Category** select, a **Title (optional)** field and
     a **Choose file** button; picking a file submits at once. The whole panel goes read-only on
     a locked month or an archived source, with the reason in its place.
5. **Monthly summary** section: the full editor on Plus, or the single line "Monthly summaries
   are part of the Reconciliation + AI plan." on the base plan.

A **"Deleted from this month"** dialog gates every download and share: "{n} expenses were
deleted from this month. Restore any that were deleted by mistake, then continue." with an
inline **Restore** per row and **Cancel** / **Continue to download**.

### Contract Summary — `/r/contract-summary`
The contract-to-date position on screen, exactly as the workbook prints it. Needs one source.

A **context strip** of muted items (contract number, contract total, base PO, performance PO,
invoice period), empty ones omitted. Then the table (min 900): `Description of Work | Scheduled
Value | Previously Billed | This Period | Total Billed to Date | % Complete | Balance to
Finish`, with a `BASE` section row, one row per line item, and a bold **Totals** row. A line
item with a performance reads `{name} (includes {amount} performance)`. Balance to Finish goes
bold red when negative.

Then a **reconciliation card** (max 460px) with four rows: total advances received, total
reconciled to date, balance remaining to reconcile, percentage of advance payments reconciled.
Then **Download summary (Excel)** (primary), disabled when blocked with the reason beneath.
Then **Reporting periods**: `Month | Status | Details` where Status is Reconciled / Submitted /
Open, expanding to list every lock event for months with more than one.

### Line Items — `/r/line-items`
h1 "Line Items", subtext "Budget line items used across the dashboard, expenses, cover sheets,
and packet. Order here controls their order in documents."

Table (min 900): `(reorder) | Line Item Name | Scheduled Value | Performances | Opening
Previously Billed | Actions`. The reorder column is stacked ▲/▼ buttons, disabled at the ends.
Scheduled Value is the effective total; Performances is the performance-only slice or `-`.
Actions: **Manage** and **Delete** (both quiet). Bottom: **"+ Add line item"** (secondary)
opening a card with **Line item name**, **Scheduled value**, **Opening previously billed
(optional)**.

The **Manage** modal (large) holds the name and values in a three-column grid, then a
performances table `Name | Date | Amount` opening with a "Base value" row and closing with a
bold Total, each row with inline **Edit** / **Delete**, plus an add row beneath.

### Monthly summary — `/r/monthly-summary` (Plus only)
An AI-written draft of the month for a person to check and edit. On the base plan the screen is
one sentence. Otherwise a two-column grid: the editor on the left, **Saved summaries** on the
right.

Before a summary exists: a gradient-framed card with **Write draft summary** (primary),
disabled when the month has no expenses. While running: "Writing your summary… This can take up
to a minute." Afterwards: the month as a heading with "Draft written {date}" and "Last edited
{date} by {name}", **Copy text** / **Download Word** / **Download PDF** (all secondary, disabled
while there are unsaved changes), a stale notice when expenses have changed since, a calm grey
note with a sparkle icon ("This is a draft written by AI from your records. Check every figure
and fill in anything in [brackets] before using it."), the rich editor with **Bold** and
**Bullet list**, and a footer bar with **Save changes**, a live status word, and **Write again**
behind a confirm.

### Settings — `/r/settings`
A sidebar plus one panel, stacked on mobile and sticky at `lg`. Sidebar items: **Organization ·
Funding sources · Lists · Vendor library · Users (admin only) · Account**, each an outline icon
and label, the active one a solid accent pill.

- **Organization** — Organization name, Document display name ("Printed on cover sheets and the
  packet."), **Save**. On the Plus plan, a bordered block with the switch **"Read amounts from
  uploaded documents"** and the helper "Receipts and proofs of payment are sent to OpenAI to
  suggest amounts. OpenAI doesn't use them for training. Nothing is saved until you confirm."
  Managers see it disabled.
- **Funding sources** — a **"Show archived (N)"** switch, then one expandable row per source
  with its name, an uppercase type label, an "Archived" pill, **Edit** and
  **Archive**/**Unarchive**. Expanding shows three tiles (contract value, advances received,
  contract period), a definition grid, and two chips for the tax and fee rules. Editing replaces
  the panel in place with the full form. **Add funding source** at the bottom.
- **Lists** — two columns, **Payment sources** and **Supporting document types**, each a list of
  labels with Deactivate/Reactivate and Edit, a deactivated label struck through, and an input
  plus **Add** beneath.
- **Vendor library** — a short preview table `Name | Default line item | Default payment source
  | Default description | Last amounts | Actions`, with **"Show all {N} vendors"** beneath and
  the helper "The library learns automatically every time you save an expense."
- **Users** (admin only) — the same manager as `/r/settings/users`.
- **Account** — email read-only, current password, new password ("At least 12 characters."),
  confirm, with "Changing your password signs out every other device." Then an **App guide**
  card with **"Show the app guide again"**.

### Users — `/r/settings/users` (admin only)
Table (min 640): `User | Role | Added | Actions`, the user cell showing the display name over a
muted email. **Edit name** and **Reset password** per row. After a reset a notice appears: bold
"Password (shown once): {password}" with "Give it to the user yourself, for example by text. It
can't be shown again." plus **Copy** and **Dismiss**. An **Add user** block takes a Name and an
Email.

### Vendor library — `/r/settings/vendors`
The full table with a **Search vendors** input (debounced) and pagination, state in the URL.

### Auth screens
Shared layout: paper background, content top-centred, a white card.

- **`/login`** (max 440px): centred logo, h1 **"Sign in to your organization"**, a red panel for
  errors, **Email** (placeholder `you@yourorganization.org`), **Password**, a full-width primary
  **Sign in** ("Signing in…"), and the centred line "Forgot your password? Email
  tech@teampursuit.org."
- **`/signup`**: closed by default, showing "Sign-ups are closed." and a support line. When open:
  Organization name, Your name, Email, Password (with Show/Hide and "At least 12 characters."),
  Confirm password, **Create account**.
- **`/onboarding/line-items`** (max 720px): eyebrow "Step 1 of 2", h1 "Set up your budget line
  items", a table `Line item | Budget | Remove` prefilled with six starter names and **empty
  budgets**, **Add line item**, a bold **"Total budget: $X"**, and **Continue** disabled until at
  least one row has a name and a budget above zero.
- **`/onboarding/contract`**: eyebrow "Step 2 of 2", h1 "Your contract", all fields optional —
  total contract value, start and end dates, fiduciary name — then **Finish setup**, **Skip for
  now**, and **Back to budget line items**.

### Staff admin — `/a`
A separate shell: "AB Solutions admin" over the staff member's name, and **Sign out**. No month
selector, no funding source selector, no nav tabs, no footer.

- **`/a`** — h1 "Organizations". Eight summary tiles that double as filters (Reconciliation,
  Reconciliation + AI, Complimentary, Suspended, Trial, Active, Past due, Cancelled), each 13px
  label over a 26px bold count, the active one accent-filled. Then Search, Filter by plan,
  Filter by status, a count line, and a table (min 900) `Organization | Signed up | Plan | Status
  | Users | Last sign-in` with badge rows for status.
- **`/a/orgs/{id}`** — stacked cards: identity (name, document name, signed up, setup finished,
  plan and status, and a users table), **Usage** (funding sources, expenses, last expense added,
  months submitted, months locked, packets downloaded, and a full-width **Storage** tile with a
  progress bar), **AI usage** (Receipt reads, Monthly summaries, Invoice reads, Runs with nothing
  saved, Cost all time, Last run), **Actions** (Change plan, Complimentary access,
  Suspend/Reinstate), and **History**.

### Public shared link — `/s/{token}`
No shell, no nav. The same centred paper layout as sign-in, a 440px card with the logo. Three
states: **open** (redirects straight to the file), **password protected** (h1 "This file is
password protected." with a Password field and **Open file**), and **unavailable** ("This link is
no longer available. Please ask the sender for a new one." — deliberately identical for every
cause, so a probe learns nothing).

### Error screens
- **Not found**: h1 "Not found", "That page doesn't exist, or it has been deleted." and a **Back
  to the dashboard** link inside an empty state.
- **Error**: h1 "Something went wrong", "The page could not be loaded. Nothing you had already
  saved is affected.", a blocking panel with "Try again, and if it keeps failing, contact support
  at tech@teampursuit.org. Say what time it happened." and a **Try again** button.

---

## 11. Conditional behaviour

| Condition | What changes |
|---|---|
| **Single funding source** | No source selector in the header; no Funding source column anywhere; no source filter; the form's source field is static text. |
| **Header on "All funding sources"** | Dashboard shows one section per source with no combined total. Expenses and Trash gain a source filter. Cover Sheets, Packet, Contract Summary, Line Items and Monthly summary all show a **PickFundingSource** panel instead of the screen. |
| **Plus plan** (`reconciliation_ai`, the Settings switch on, and OpenAI configured) | The Plus badge, the "Extract From Invoice" button, the amount suggestion panel, uploads moved above the amounts, the reading switch in Settings, and a usable Monthly summary. All absent on the base plan. |
| **Admin vs manager** | Admin only: expense **History**, the Settings **Users** section, `/r/settings/users`, and toggling the read-amounts switch. |
| **Locked month** | Expense Delete, Trash Restore and Delete permanently, Recurring Add and Remove, and the invoice button are all disabled with "{Month} is locked. Unlock it on the Month-End Packet tab to make changes."; the expense form is fully disabled; month documents go read-only; the packet header shows Reconciled with **View signed packet** and **Unlock**. |
| **Archived funding source** | Still selectable so its history stays reachable. Month documents go read-only. Line Items does not offer it; Cover Sheets, Packet, Contract Summary and Monthly summary do. |
| **Empty month** | "No expenses recorded for {Month} yet." / "This month has no expenses." but still downloadable. |
| **Plan cancelled** | Share link and Update shared file are disabled with "Files can't be shared while your organization's plan is cancelled." |
| **Drafts present** | The Expenses toolbar gains "Waiting for review (N)". Drafts are in no total, gate, packet, cover sheet, workbook or summary, and hold no reference number until approved. |

---

## 12. Formatting

| Thing | Format | Example |
|---|---|---|
| Money | `$#,##0.00`, negatives lead with the sign, always right-aligned and tabular | `$1,234.56`, `-$145.00` |
| Percent | Whole number, half away from zero | `86%` |
| Date | US short | `3/2/2026` |
| Date (admin) | Day month year | `16 Aug 2026` |
| Date and time | | `02/14/2026, 3:04 PM` |
| Month | Long | `February 2026` |
| Month (compact) | Short | `Feb` |
| Reference | `{month}-{3 digits}` | `2026-02-001` |
| Cover sheet heading | Name, reference, colon | `Misty Jones (2026-02-014):` |
| Empty table cell | | `-` |
| Storage | Rounded before choosing the unit | `212 MB`, `4.8 GB` |

---

## 13. Voice

Every string the app shows or prints follows these rules, and a test fails the build on the
first one.

1. **No em dashes or en dashes anywhere the app writes.** Two thoughts become two sentences, or
   a comma joins them. Ranges use "to". Separators are ` · ` on screens and ` | ` on documents
   and tab titles. An empty cell shows `-`. Text people type keeps whatever they typed.
2. **Plain American English.** "Organization". "Check" or "select", never "tick".
3. **Say what happened, then what to do.** Never blame the user. "Please" only when asking for
   real effort.
4. **No internal words.** Never "S3", "artifact", "request", "session", "server action" or a rule
   number. Support is just "support".
5. **One name per thing**: expense, line item, funding source, receipt, proof of payment,
   narrative, cover sheet, packet, month documents. "Sign in" and "Sign out".
6. **Sentence case** for buttons, headings, labels, dialog titles and menu items. Tab names are
   proper names and keep Title Case.
7. **Full sentences end with a period**, toasts included. Labels, buttons and headings do not.
8. **Contractions are fine** in messages.
9. **"…" for work in progress**: "Saving…", "Preparing the packet…".
10. **City-approved document wording keeps its exact words**: the tax and fee notes, "Please see
    below…", cover sheet titles, the summary sheet's column names, the footer's parts and order.

---

## 14. Where the older specs disagree with the code

If a designer reads `docs/03-modules/`, these are the places it is out of date.

1. **There is no `/r/expenses/new/from-invoice` route.** The directory holds a component; the
   check screen renders inside `/r/expenses/new`.
2. **Drafts are a separate view, not a section stacked at the top of the Expenses list.**
3. **The invoice entry point has no upload screen** — no title, no explanatory paragraph, no
   "Read invoice" / "Cancel". The button opens the file picker and the read starts on pick.
4. **No tickboxes and no "Create drafts" button.** Each card has **Remove**, and one **Done**
   writes everything.
5. **Photos are accepted**, not PDF only.
6. **Packet contents currently starts at the first cover sheet.** The contract summary sheet and
   expense index rows are commented out, so they do not render and their pages are not counted.
7. **On the Plus plan the upload fields sit above the amounts**, not below.
8. **The expenses table header is `Ref / Date`**, one sticky column holding both, and the amount
   column is headed **Amount**.
9. **Settings is a sidebar** with one section visible, not stacked cards, and the vendor preview
   carries two extra columns.
10. **`draftNeeds` can emit a third string** — "Enter a name, choose a line item, and choose a
    payment source." — which reads oddly in a "Still needs" cell and is worth rewording.

---

## 15. What was not verified

- Nothing here was checked in a browser. Every detail is read from the route files, the shared
  components and the theme.
- The tour step copy on each screen is not inventoried.
- The public marketing page at `/` is a separate visual system under a `.lp` class with its own
  tokens and type scale, and is deliberately out of scope.
- The `text-muted` token gap in §2 was confirmed by reading the theme and counting call sites,
  not by inspecting the generated stylesheet.
