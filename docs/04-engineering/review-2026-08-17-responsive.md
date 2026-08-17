# UI review — mobile and tablet responsiveness

Measured against the running app at 375×812 (phone), 768×1024 (tablet) and 1280 (desktop),
page by page. Every number below was read off the live DOM, not estimated.

The headline: the application was built desktop-only. Across ~40 components there are
**six** responsive utilities in total, all of them `grid-cols`. There is no responsive
typography, no responsive spacing, and no responsive chrome.

```
sm:  0 occurrences
md:  4 occurrences   (md:grid-cols-2 ×3, md:grid-cols-3 ×1)
lg:  2 occurrences   (lg:grid-cols-2, lg:grid-cols-[minmax…])
```

The good news is that nothing is actually *broken*: no page overflows horizontally at any
width, wide tables already scroll inside their own card rather than the page, and no tap
target is under 44px. The problems are proportion and density, not layout collapse.

---

## F1 — Two thirds of a phone screen is chrome before any content · Highest impact

| Viewport | Header height | Share of screen |
|---|---|---|
| 375×812 | **545px** | 67% |
| 768×1024 | 329px | 32% |
| 1280 | 210px | — |

The navigation alone is **280px on a phone**, because eight links wrap into four ragged rows
with a large gap between them. A user opening the dashboard on a phone scrolls past a
full screen of chrome before reaching a single figure.

The org name renders at 24px and the page title at 28px on a 375px-wide screen — both sized
for a desktop header and never reduced.

**Fix:** the nav becomes a single horizontally-scrollable row on small screens rather than
wrapping; header padding, the org name and the log-out control step down; the month selector
and nav share a row where they fit.

## F2 — Headings are inconsistent *before* any breakpoint is considered

Three screens hand-roll an `<h2>` instead of using the `SectionTitle` primitive, and all
three omit `font-bold`:

| Where | Class | Rendered |
|---|---|---|
| Settings ×6 | `SectionTitle` | 20px Georgia **bold** |
| Month-End Packet — "Packet contents" | `font-serif text-xl text-ink mb-1` | 20px Georgia, *not bold* |
| Month documents card | `font-serif text-xl text-ink mb-1` | 20px Georgia, *not bold* |
| Cover Sheets — per-line-item | `font-serif text-xl text-ink mb-3` | 20px Georgia, *not bold* |

Four more screens hand-roll `<h1>` as `font-serif text-[28px] font-bold …` rather than using
`PageTitle` — the auth and onboarding pages, plus the two 404s. They happen to match today,
which is precisely why they will drift the first time the scale changes.

**Fix:** one primitive per level, used everywhere, with the responsive step built into the
primitive so a page cannot opt out by accident.

## F3 — No shared scale, so "the same size" is a coincidence

Sizes are written as literals at each call site: `text-[28px]`, `text-xl`, `text-[15px]`,
`text-[13px]`, `text-base`, `text-sm`. Card padding varies between five different values on
one screen (`26px 28px 24px`, `12px 14px`, `0 12px`, `0 18px`, `0`). Container padding is a
flat `px-6` at every width.

There is nothing to change *once*. Making H2 18px on phones currently means finding and
editing every H2 by hand — exactly the drift the request is about.

**Fix:** a documented type and spacing scale, expressed as reusable component primitives, so
each level has one definition and one responsive rule.

## F4 — The cover sheet preview is unreadable on a phone

The preview is the product's trust-builder: it shows what the City will receive. At 375px:

```
card width          327px
padding             40px + 40px      ← 24% of the card
usable width        247px
Role column (61%)    98px            ← holds full sentences at 13px
```

Roughly eleven characters per line for the description that prints on the real document.

**Fix:** the document padding steps down on small screens, and the preview scrolls
horizontally at a readable minimum width rather than compressing — the same treatment the
data tables already get.

## F5 — Reading order breaks where a control sits beside a title

Cover Sheets puts the line-item selector in a `justify-between` row with the `<h1>`. On a
phone it wraps, and the subtext that belongs to the title ends up *below* the control:

```
Cover Sheets            ← title
Line item [Salary ▾]    ← control
Breakdown documents…    ← subtext, now orphaned from its title
```

The Month-End Packet header has the same shape with its "Mark as submitted" action.

**Fix:** the title block stays together; controls drop below it as a group on small screens.

## F6 — Wide tables scroll, but at unreadable ratios

Structurally correct — each table scrolls inside its own card, and the page never overflows.
But the ratios on a phone are severe:

| Screen | Table min-width | Visible | Ratio |
|---|---|---|---|
| Expenses | 1180px | 325px | 3.6× |
| Contract Summary | 980px | 325px | 3.0× |
| Dashboard | 860px | 325px | 2.6× |
| Month-End Packet | 720px | 325px | 2.2× |

A user scrolling the Expenses table sideways loses the row they were reading, because the
first column scrolls away with everything else.

**Fix:** for this MVP, keep the scroll (a card layout per row is a redesign, not a polish
pass) but pin the identifying first column so the row stays identifiable, and reduce the
min-widths where columns are simply over-padded for phones.

## F7 — Tablet lands in an awkward middle

At exactly 768px the `md:` breakpoint fires, so a portrait tablet gets the full two- and
three-column desktop grids: a three-column settings row becomes **207px per field**. Nav is
two rows at 128px.

**Fix:** shift multi-column form grids to `lg:` so portrait tablets get comfortable
single/two-column layouts, keeping three-across for genuine desktop widths.

---

# The scale to standardise on

One definition per level. Phone is <640px (`sm` and below), tablet 640–1023px, desktop
1024px+.

| Level | Phone | Tablet | Desktop | Used for |
|---|---|---|---|---|
| Page title (h1) | **22px** | 24px | 28px | One per screen |
| Section title (h2) | **18px** | 20px | 20px | Cards, page sections |
| Subsection (h3) | 16px | 17px | 17px | Groups inside a card |
| Body | 15px | 15px | 15px | Tables, form values |
| Subtext | 15px | 16px | 16px | The line under a title |
| Small | 13px | 13px | 13px | Helper text, counts |
| Org name (chrome) | 18px | 20px | 24px | App header |

Spacing, likewise:

| Token | Phone | Tablet | Desktop |
|---|---|---|---|
| Page gutter | 16px | 24px | 24px |
| Card padding | 16px | 20px | 24px |
| Section gap | 24px | 28px | 32px |

18px for an H2 on a phone is the number in the request, and it is what every H2 in the app
will render at once the primitives own the rule.

# Plan

1. Add the scale as reusable primitives — `PageTitle`, `SectionTitle`, `SubsectionTitle`,
   `Subtext`, `Card`, and a `PageHeader` that keeps a title, its subtext and its actions in
   the right order at every width.
2. Replace all nine hand-rolled headings with the primitives.
3. Make the app shell responsive: scrolling nav, stepped-down header.
4. Step down the container gutter and card padding.
5. Fix the cover sheet preview padding and give it a readable scroll minimum.
6. Move form grids from `md:` to `lg:`, and pin the first column on the widest tables.
7. Re-measure all three widths and confirm every H1/H2 matches the table above on every page.


---

# Results

Measured after the change, at the same three widths.

## Chrome reclaimed

| | Phone (375) | Tablet (768) |
|---|---|---|
| Header height | 545 → **222px** | 329 → **248px** |
| Nav height | 280 → **48px** | 128 → **52px** |
| Share of a phone screen | 67% → **27%** |  |

The dashboard table is now visible on the first screen instead of a screenful below it. The
nav is one scrolling row at every width below `lg`, and the active tab is scrolled into view
on load.

## The scale holds on every page

Every `<h1>` and `<h2>` in the application now resolves to the same primitive classes —
checked by fetching all nine screens and diffing the rendered class strings.

| | Phone | Tablet | Desktop |
|---|---|---|---|
| h1 | 22px | 24px | 28px |
| h2 | **18px** | 20px | 20px |

Settings, Month-End Packet and Cover Sheets all render their h2 at 18px on a phone, which is
the specific consistency the request asked for. Desktop is unchanged from the approved
design: 28px and 20px.

The one heading that deliberately does not follow the scale is the title *inside* the cover
sheet preview — that is document typography mirroring the generated Word file's 12pt title,
not app chrome, and changing it would break the 1:1 promise the preview exists to keep.

## Per-finding outcome

- **F1** Fixed. Numbers above.
- **F2** Fixed. Nine hand-rolled headings replaced; three of them had been silently non-bold.
- **F3** Fixed. `PageTitle`, `SectionTitle`, `SubsectionTitle`, `Subtext`, `PageHeader` and a
  shared `CARD_PADDING` now own the scale. `CARD_PADDING` is exported as a string rather than
  baked into `Card`, because `cn` joins classes without merging them by design — a default
  would have collided with the eleven callers that set their own padding.
- **F4** Fixed. The preview scrolls at a 560px minimum instead of compressing: the Role
  column went from **98px to 306px**, and padding steps 20 → 32 → 40px.
- **F5** Fixed. `PageHeader` keeps title, subtext and actions in the right order at every
  width; Cover Sheets and Month-End Packet both use it.
- **F6** Fixed. The first column of every wide table is pinned below `lg` — verified by
  scrolling the packet table 319px and confirming "Salary" stayed at x=17. Min-widths trimmed
  to match the tighter mobile cell padding (Expenses 1180 → 1040).
- **F7** Fixed. Form grids moved from `md:` to `lg:`, so a portrait tablet gets one or two
  comfortable columns instead of three at 207px each. Desktop keeps three-across.

No page overflows horizontally at any width, and no tap target is under 44px.
