# Design Language & Claude Design Preamble

The visual system comes from the client-approved prototype, as restyled by the client's redesign (PR #21, D-121). Every module's UI must read as one product; since each module is generated in Claude Design from a separate prompt, **always paste the preamble below first**, then the module prompt.

Final prompt = `[PREAMBLE]` + blank line + `[module file → "Claude Design prompt" section]`.

## Token reference (for implementation)

| Token | Value | Use |
|---|---|---|
| paper | `#F4F4F3` | App background: a near-neutral grey, so white cards read as raised (was `#FBF9F5`) |
| surface | `#FFFFFF` | Cards, tables, menus |
| ink | `#211B16` | Primary text |
| sub | `#5B5147` | Secondary text, labels |
| line | `#D8D0C4` | Borders, dividers |
| accent | `#5B3A29` | Primary buttons, links, the active tab's text |
| accent-dark | `#3E2719` | Hover; the nav pill; the dark end of every gradient |
| plus-light | `#94603F` | The light end of every gradient (white text clears 5.3:1 on it) |
| primary-fixed | `#FFDBCB` | Focus ring inside a dark container (`surface-dark`) |
| danger | `#8A2A22` / bg `#F6E7E4` | Errors, missing docs, negative/low budget |
| success | `#2F4F3E` | Added/complete states |
| doc-yellow | `#FFFF00` | ONLY inside document-preview tables (mimics the real submission docs) |
| section-bg | `#F1ECE2` | Table section header rows |
| autofill | `#F3E9DD` | Autofilled field flash |
| Type | Plus Jakarta Sans, everything on screen | Headings keep the `font-serif` role name (Georgia is only the fallback). Documents and their previews use `--font-document` |
| Headings | Bold; page titles gradient-set (`GRADIENT_TEXT`) | See the responsive scale below |
| Body | 15–16px | Tables 15–16px, column headers 13px uppercase letterspaced in white on the header band |
| Cards | white, 1px `line` border, radius 10px | `Card`; soft shadow only on raised elements (menus, the nav pill) |
| Table header | `accent-dark` → `plus-light` gradient band, white text | Set once on the header row so it runs as one band across every column |
| Controls | min-height 44px (buttons 48px), radius 3px | Primary: accent bg/white text; Secondary: white bg/accent border+text. Header selectors are compact pills |
| Focus | 2px ring, `accent`; `primary-fixed` inside `surface-dark` | Always visible, on every surface |

## Responsive scale

Breakpoints: **phone** below 640px, **tablet** 640–1023px, **desktop** 1024px and up — i.e.
Tailwind's `sm:` and `lg:` mark the two boundaries, so components read as "phone value, then
`sm:`, then `lg:`". Desktop values are the approved design; the smaller steps are additions.

| Level | Phone | Tablet | Desktop | Primitive |
|---|---|---|---|---|
| Page title (h1) | 22px | 24px | 28px | `PageTitle` |
| Section title (h2) | 18px | 20px | 20px | `SectionTitle` |
| Subsection (h3) | 16px | 17px | 17px | `SubsectionTitle` |
| Subtext | 15px | 16px | 16px | `Subtext` |
| Table cell | 15px | 16px | 16px | `Td` |
| Org name (chrome) | 18px | 20px | 24px | app shell |
| Page gutter | 16px | 24px | 24px | app shell |
| Card padding | 16px | 20px | 24px | `CARD_PADDING` |

**Every heading comes from its primitive.** Sizes were literals at each call site once, and
three screens quietly ended up with a non-bold h2 as a result. A page that writes its own
`text-[28px]` is a bug, not a variation.

`CARD_PADDING` is a string constant rather than a default inside `Card`, because `cn` joins
classes without merging them — components compose fixed variants instead of overriding
utilities (see `src/lib/cn.ts`), so a default would collide with callers that set their own.

Layout rules that follow from the scale:

- The primary nav is one dark pill of tabs from `xl`, the active tab reversed out in white. Below
  `xl` it is a single menu button naming the current screen, which opens the full list; it is
  never a wrapped or scrolling row of nine tabs. The header has no bar of its own: the mark,
  the nav, the month and funding-source pills, and the account menu sit on the page.
- A screen's title, subtext and controls go through `PageHeader`. Putting a control in a
  `justify-between` row with the title makes the subtext wrap below it on a phone, orphaning
  it from the heading it describes.
- Wide tables scroll inside their card, never the page, and pin their first column below
  `lg` (`<Th sticky>` / `<Td sticky>`) so a row stays identifiable while scrolling.
- Multi-column form grids use `lg:`, not `md:` — at exactly 768px a portrait tablet was
  getting three fields across at 207px each.

---

## Words (D-113, PHASE-13)

Every string the app shows or prints follows these rules. The people using the app are
non-technical, and some of these words reach the City on signed documents.

1. **No em or en dashes, anywhere the app writes.** Two thoughts become two sentences, or a comma
   or colon joins them. An aside goes in commas or brackets. Ranges use "to" ("1 to 10 of 45").
   Separators are " · " on screens and " | " on documents and browser tab titles (the packet
   summary's contract line keeps its " · ", which the City already knows). An empty table
   cell shows "-". Text people type keeps whatever they typed. `src/domain/no-dashes.test.ts`
   fails on a dash in any string, template or JSX text in app code.
2. **Plain American English.** "Organization"; "check" or "select", never "tick".
3. **Say what happened, then what to do.** Never blame the user. "Please" only when asking for
   real effort.
4. **No internal words.** Never "Mantaq", "S3", "artifact", "request", "session", "server
   action", "Phase N" or a rule number. Support is "support" (`UI.supportEmail`).
5. **One name per thing:** expense, line item, funding source, receipt, proof of payment,
   narrative, cover sheet, packet, month documents. "Sign in" and "Sign out".
6. **Sentence case** for buttons, headings, labels, dialog titles and menu items. Tab names are
   proper names and keep Title Case: Dashboard, Add Expense, Expenses, Cover Sheets, Month-End
   Packet, Contract Summary, Line Items, Recurring, Settings.
7. **Full sentences end with a period**, toasts included. Labels, buttons and headings don't.
8. **Contractions are fine in messages** ("can't", "won't").
9. **"…" (one character) for work in progress:** "Saving…", "Preparing the packet…".
10. **City-approved document wording keeps its words:** the tax and fees notes, "Please see
    below…", cover sheet titles, the summary sheet's layout and column names, and the footer's
    parts and order.

## PREAMBLE (paste this block first, verbatim)

```
DESIGN SYSTEM — apply to everything below.

Product: "Stay Funded 360" — a calm, serious tool for a small nonprofit that prepares
monthly grant reimbursement packets for city government reviewers. The aesthetic is warm and
layered but restrained: white cards raised off a light grey page, deep browns, and a
brown-to-caramel gradient used only in the named places below. No glassmorphism, no
illustrations, no emoji. It should feel trustworthy, legible and unhurried.

Palette: page background #F4F4F3. Cards: #FFFFFF with 1px #D8D0C4 borders, radius 10px.
Primary text #211B16, secondary #5B5147. Accent (primary buttons, links): deep brown #5B3A29,
hover #3E2719. Gradient: #3E2719 to #94603F, used for table header rows (one band across the
row, white uppercase text), page titles (as text), and a highlighted stat tile — nowhere else.
Danger/red #8A2A22 with soft background #F6E7E4. Success green #2F4F3E. Pure yellow #FFFF00 is
reserved exclusively for cells inside document previews that mimic the real submission
documents (header rows and total cells) — never use it for UI chrome.

Typography: Plus Jakarta Sans throughout. Page titles 28px bold, section titles 20px bold,
body 15-16px, table text 15-16px, column headers 13px uppercase with slight letter-spacing.
Money always right-aligned, tabular numerals, formatted $1,234.56. Document previews use the
document's own font (Aptos/Calibri), not the app's.

Components: buttons min-height 48px (primary: brown bg, white bold text; secondary: white bg,
1px brown border, brown text; quiet text-links in brown, underlined). Inputs/selects: white,
1px #D8D0C4 border, 12-14px padding, 16px text, min-height 44px, 3px radius, visible labels
above in 15px semibold. Tables: white card, gradient header row with white text, 1px #D8D0C4
row dividers, faint alternate-row banding, 12-16px cell padding. Errors: #8A2A22 text on #F6E7E4
panels with a 2px #8A2A22 border for blocking states. Empty states: dashed 1px #D8D0C4 box
with centered secondary text.

App chrome (when the prompt includes the shell): no header bar; on the page itself — left:
the Stay Funded 360 mark; then the nav, a dark #3E2719 pill of tabs: Dashboard, Add Expense,
Expenses, Cover Sheets, Recurring, Month-End Packet, Contract Summary, Line Items, Settings —
active tab: white pill with bold #5B3A29 text; inactive: white text at 75%. Right: "Month" and
"Funding source" as compact white pill selects, then a round avatar opening the account menu
(Your profile, Sign out). Content area: max-width 1220px, centered, 24px side padding.

Layout is desktop-first but must degrade gracefully to a 390px phone (tables scroll
horizontally inside their card; below 1280px the nav becomes one menu button naming the
current screen; touch targets ≥44px). Use realistic data from the
prompt — never lorem ipsum. Interactions should work (tabs switch, forms validate, buttons
change state) so the client can click through the mockup.
```
