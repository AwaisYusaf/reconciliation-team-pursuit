# Design Language & Claude Design Preamble

The visual system comes from the client-approved prototype. Every module's UI must read as one product; since each module is generated in Claude Design from a separate prompt, **always paste the preamble below first**, then the module prompt.

Final prompt = `[PREAMBLE]` + blank line + `[module file → "Claude Design prompt" section]`.

## Token reference (for implementation)

| Token | Value | Use |
|---|---|---|
| paper | `#FBF9F5` | App background |
| surface | `#FFFFFF` | Cards, tables, header bar |
| ink | `#211B16` | Primary text |
| sub | `#5B5147` | Secondary text, labels |
| line | `#D8D0C4` | Borders, dividers |
| accent | `#5B3A29` | Primary buttons, active nav, links |
| accent-dark | `#3E2719` | Hover |
| danger | `#8A2A22` / bg `#F6E7E4` | Errors, missing docs, negative/low budget |
| success | `#2F4F3E` | Added/complete states |
| doc-yellow | `#FFFF00` | ONLY inside document-preview tables (mimics the real submission docs) |
| section-bg | `#F1ECE2` | Table section header rows |
| autofill | `#F3E9DD` | Autofilled field flash |
| Headings | Georgia serif | See the responsive scale below |
| Body | Arial/Helvetica 15–16px | Tables 16px, column headers 13–14px uppercase letterspaced |
| Controls | min-height 44px (buttons 48px), radius 3–4px | Primary: accent bg/white text; Secondary: white bg/accent border+text |

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

- The primary nav is one horizontally-scrolling row below `lg`, never wrapped. Wrapping put
  nine links on four rows and made the header two thirds of a phone screen.
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
   Separators are " · " on screens and " | " on documents and browser tab titles. An empty table
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

Product: "Stay Funded 360" — a calm, serious internal tool for a small nonprofit
that prepares monthly grant reimbursement packets for city government reviewers. The aesthetic
is quiet, paper-like, government-document adjacent. No gradients, no glassmorphism, no
illustrations, no emoji, no rounded-bubble SaaS styling. It should feel like well-organized
paperwork: trustworthy, legible, unhurried.

Palette: page background #FBF9F5 (warm paper). Cards/tables/header: #FFFFFF with 1px #D8D0C4
borders, border-radius 3-4px, no shadows (or a bare minimum). Primary text #211B16, secondary
#5B5147. Accent (primary buttons, active nav underline, links): deep brown #5B3A29, hover
#3E2719. Danger/red #8A2A22 with soft background #F6E7E4. Success green #2F4F3E. Pure yellow
#FFFF00 is reserved exclusively for cells inside document previews that mimic the real
submission documents (header rows and total cells) — never use it for UI chrome.

Typography: headings in Georgia (serif) — page titles 28px, section titles 20px. Everything
else Arial/Helvetica — body 15-16px, table text 16px, column headers 13-14px uppercase with
slight letter-spacing in #5B5147. Money always right-aligned, tabular numerals, formatted
$1,234.56.

Components: buttons min-height 48px (primary: brown bg, white bold text; secondary: white bg,
1px brown border, brown text; quiet text-links in brown, underlined). Inputs/selects: white,
1px #D8D0C4 border, 12-14px padding, 16px text, min-height 44px, 3px radius, visible labels
above in 15px semibold. Tables: white background, header row with 2px solid #211B16 bottom
border, 1px #D8D0C4 row dividers, 14-16px cell padding. Errors: #8A2A22 text on #F6E7E4
panels with a 2px #8A2A22 border for blocking states. Empty states: dashed 1px #D8D0C4 box
with centered secondary text.

App chrome (when the prompt includes the shell): white header bar with 1px bottom border —
left: organisation name in Georgia 24px bold with "Stay Funded 360" in 15px
#5B5147 beneath; right: quiet "Sign out" secondary button. Below it a "Month" labeled select
(200px) and a horizontal nav of text tabs: Dashboard, Add Expense, Expenses, Cover Sheets,
Recurring, Month-End Packet, Contract Summary, Line Items, Settings — active tab: bold #211B16
with 3px #5B3A29 underline; inactive: #5B5147. Content area: max-width 1100px, centered,
32px top padding, 24px side padding.

Layout is desktop-first but must degrade gracefully to a 390px phone (tables scroll
horizontally inside their card; nav wraps; touch targets ≥44px). Use realistic data from the
prompt — never lorem ipsum. Interactions should work (tabs switch, forms validate, buttons
change state) so the client can click through the mockup.
```
