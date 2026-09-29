# Phase 7 — Guided tours for the four confusing screens

Planning document. Not started — no code, no migration, no dependency added yet. Written
against `implementation/Multi-Grant` at commit `ca4a331` (2026-09-14); update file:line
references if the branch has moved since.

The product ask is reproduced verbatim in **Appendix A**. Read it first; this document is the
build plan for it, not a restatement.

---

## 1. What this is, in one paragraph

Four short, skippable, once-only walkthroughs — Dashboard, Add Expense, Recurring, Month-End
Packet — that start automatically the first time a user opens that tab, and never come back
once shown, on any device, until they're deliberately reset from Settings. The rule that shapes
every technical choice below: **"shouldn't reappear on the same user's other device."** That
alone rules out `localStorage` (per-browser, not per-user) as the persistence layer — it has to
be a database read on the server, keyed by user id, not by device.

---

## 2. Investigation — what already exists

- **No tour library is installed.** `package.json` has no `react-joyride`, `driver.js`,
  `shepherd`, `intro.js`, or similar. This is a build-or-buy decision (§7, Open Question 1).
- **The one existing "seen once" pattern is org-level, not user-level, and uses
  `localStorage`-adjacent thinking via a DB column**: `organizations.welcome_dismissed_at`
  (`src/db/schema.ts`), set by `dismissWelcomeAction` (`src/modules/auth/actions.ts:422-429`),
  read into `session.welcomeDismissed` via `resolveSession` (`src/services/auth/store.ts`), and
  rendered by `WelcomeBanner` (`src/components/app-shell/welcome-banner.tsx`). It is **org-wide**
  — every user of an org shares one dismissal. The new tours must NOT copy this shape: the spec
  requires per-**user** state ("every user sees each tour once... including staff added
  later"). This is the one place in the existing code that looks similar but is the wrong model
  to copy.
- **Overlay precedent**: `OverlayShell` (`src/components/ui/overlay-shell.tsx`) is the portal +
  focus-trap + Escape + scroll-lock code shared by `Dialog` and `Modal`, at `z-50`. A tour
  spotlight is a new, different kind of overlay (it must let the highlighted element stay
  visible and interactive-looking while dimming everything else, and it doesn't have a fixed
  confirm/cancel footer) — it should **not** reuse `OverlayShell` as-is, but should reuse its
  proven parts: portal to `document.body`, Escape-to-dismiss, scroll-lock, and the `inert`-based
  focus containment pattern. See decision 3.4.
- **Existing z-index ceiling is 50** (`Modal`, `Dialog`, the document viewer). A tour must sit
  above the sticky tab nav (`z-30`, `app/r/layout.tsx:75`) and an open `Select` (`z-40`,
  `src/components/ui/select.tsx:291`), so it needs its own layer at or above the existing `z-50`
  ceiling. Tours and modals are not expected to run at the same time by design (see decision
  3.9), so sharing `z-50` is acceptable, but this document proposes a dedicated `z-[60]` so a
  tour can never be accidentally buried under a `Modal`/`Dialog` opened from the page underneath
  it (e.g. `ConfirmButton`'s delete dialog) if the two ever do overlap.
- **Existing tap-target convention**: buttons across the app use `min-h-11` (44px) or `min-h-12`
  (48px). The tour's Next/Back/Skip controls should match this, not invent a new size.
- **The four target screens, concretely:**
  - **Header (shared shell, `app/r/layout.tsx:60-61`)**: `<MonthSelector>` and, only when the
    org has more than one funding source, `<FundingSourceSelector>` — both render once, shared
    by every tab. The Dashboard tour's steps 1–2 target these shared elements, not anything
    Dashboard-specific.
  - **Nav (shared shell, `src/components/app-shell/app-nav.tsx`)**: the "Add Expense" tab link.
    Dashboard tour step 4 targets this shared element too.
  - **Dashboard budget table**: `app/r/page.tsx` (single-source) /
    `app/r/source-budget-section.tsx` (per-source, multi-source). The "Closing Balance" column
    header is rendered by both — see decision 3.5 for how one tour step covers both cases.
  - **Add Expense form** (`src/modules/expenses/expense-form.tsx`): has real `id`s already on
    `name` (line 510), `description` (line 679 area), and the money fields via `id={field}` at
    line 698 (`subtotal`, `tax`, `fees`). It has **no** existing id/attribute on: the
    Reimbursable-amount box (~line 758-761), the Proof-of-payment `<UploadField>` (line 787-808,
    `scope="proof"`), the Receipt `<UploadField>` + "No receipt available" checkbox (lines
    810-852). These need `data-tour` attributes added (Phase 2).
  - **Recurring** (`app/r/recurring/recurring-manager.tsx`): "Add to {month}" button per row
    (line 526), "+ Add recurring item" button when the list is empty (line 578). Both need a
    `data-tour` attribute; the tour must prefer the first if it exists, else fall back to the
    second (spec's own wording: "If the list is empty, use the 'Add recurring item' button").
  - **Month-End Packet** (`app/r/packet/page.tsx` + `month-documents.tsx` +
    `submitted-marker.tsx` + `packet-download-buttons.tsx`): "Documentation Complete" column
    header, the red "This packet cannot be downloaded yet" alert (conditionally rendered —
    absent when nothing blocks), "Month documents" heading, the two download buttons, "Mark as
    submitted" button. All need `data-tour` attributes (Phase 4). The screen already has a
    `PickFundingSource` branch when "All" is selected (confirmed live in this session's manual
    browser test) — the tour must not mount inside that branch (decision 3.6).

---

## 3. Design decisions

| # | Decision | Why |
|---|---|---|
| 3.1 | **Persistence is a new table `user_tour_progress`** (`user_id`, `tour`, `completed_at`), not four columns on `users`, and not `localStorage`. | A table means adding a 5th tour later needs zero migration (just a new `tour` value) — the ticket's own framing ("guide them through only the confusing parts") suggests this list will grow. Per-**user**, so a teammate added later naturally sees every tour (no row yet = not seen), and a "Show the app guide again" in Settings is one `DELETE ... WHERE user_id = ?`, not four column writes. `localStorage` is disqualified outright by the cross-device requirement. |
| 3.2 | **`tour` is a small closed enum**: `dashboard`, `add_expense`, `recurring`, `packet`. Composite primary key `(user_id, tour)`. | Matches the four tours in the spec exactly; a `pgEnum` (like `document_kind`, `artifact_type` elsewhere in `schema.ts`) keeps a typo from silently creating an untracked tour name. |
| 3.3 | **One server action pair**: `completeTourAction(tour)` (called on Finish **or** Skip — the spec treats them identically for persistence: "Skipping or finishing means it doesn't show again") and `resetToursAction()` (Settings' "Show the app guide again", deletes every row for the current user). Modelled on `dismissWelcomeAction`'s shape. | Skip and Finish differ only in which button was pressed, not in what gets stored — one action, one `INSERT ... ON CONFLICT DO NOTHING` (idempotent: pressing it twice, or a slow double-click, is harmless), keeps the two paths from drifting apart. *Update (D-132, 2026-09-29): Skip now marks every tour seen (`skipAllToursAction`); Finish still marks only its own.* |
| 3.4 | **A new, purpose-built overlay** (`TourGuide`, `src/components/ui/tour.tsx`), not a reuse of `OverlayShell`/`Modal`/`Dialog`. It borrows their proven mechanics (portal to `document.body`, Escape handling, scroll-lock, `inert` on background siblings) but does **not** trap focus onto itself the way a modal does — a tour spotlight should let the highlighted real element stay perceivable and its own accessible name reachable, with the tour's own Next/Back/Skip controls as a second focusable island, not a single trap. | `Modal`/`Dialog` assume "one interactive surface, everything else inert." A tour assumes "one interactive surface **plus** a real, currently-highlighted piece of the actual page." Bending `OverlayShell` to do both would make it harder to reason about for its two existing, simpler use cases. |
| 3.5 | **Anchoring via `data-tour="<key>"` attributes** added directly to the target DOM nodes (or their nearest sensible wrapper) across the files in §2, read with `document.querySelector`. Step keys are stable strings independent of copy (e.g. `dashboard-month-selector`, `add-expense-proof`). | The alternative — threading `ref`s through many unrelated component files back up to one tour controller — would touch far more code and couple components that have no other reason to know about each other. A `data-tour` attribute is a one-line addition per target, and the exact same shared-header elements (`data-tour="month-selector"`, `data-tour="funding-source-selector"`) serve the Dashboard tour's steps 1–2 without Dashboard-specific code, because they're rendered once in `layout.tsx`. The Closing Balance column header gets its `data-tour` attribute added once, in the shared table-heading spot both `app/r/page.tsx` and `source-budget-section.tsx` render through (checked at build time: confirm whether they already share one heading component; if not, add the attribute in both places, since it is a static string, not logic). |
| 3.6 | **A tour engine checks, at mount, whether each step's target exists in the DOM**, and skips (never blocks on) a step whose target is absent — this single mechanism covers every "only when" case in the spec: the funding-source step (present only when the org has >1 source, so `<FundingSourceSelector>` isn't even rendered), the "cannot be downloaded yet" alert (present only when something blocks), and Recurring's two-button fallback (try `data-tour="recurring-add-to-month"` first, else `data-tour="recurring-add-item"`). No per-tour special-casing needed beyond passing each tour its ordered step list with primary/fallback selectors. | One mechanism, reused four times, instead of four different conditionals hand-written per tour — the spec's "only when relevant" rule is structurally the same shape every time it appears. |
| 3.7 | **The Packet tour is simply not rendered while the page is in its `PickFundingSource` branch.** `app/r/packet/page.tsx` already knows synchronously (server-side) whether a single source is resolved; the tour only mounts on the branch that renders the real packet content. | Matches the spec exactly ("Don't start the tour until a source is chosen") with no client-side guessing — the page already has the answer before it renders anything. |
| 3.8 | **Tours read their "already seen" state as a single boolean prop passed from each page's Server Component**, not folded into the global `SessionContext`. Each of the four pages calls a small `hasSeenTour(userId, tour)` query and passes the result down to its own client tour component. | `SessionContext` (`src/services/auth/store.ts`) is read on every request via `resolveSession`'s join and cached per-request with React's `cache()` — it is genuinely global, org+user-wide state. Only one of the four tour flags is ever needed on any given page load; folding all four in there would make every request pay for a join it mostly doesn't use. A tour-specific `loadTourState` mirrors how `loadSourceContext` already exists as its own small query rather than being crammed into the session (§ funding sources, Phase 2). |
| 3.9 | **Tours and modals are not expected to coexist.** None of the four target screens' tour steps point at anything that also opens inside a `Modal`/`Dialog` in the current code (Line Items' "Manage" modal has no tour; the Add Expense screen's own overlays — the document viewer, the "No receipt" confirm dialog — are not tour targets). The build does not need to solve "what happens if a `Dialog` opens mid-tour"; it only needs the tour to close cleanly if the user navigates away (unmount = stop, no auto-resume — see Open Question 4). | Avoids building conflict-resolution logic for a case the actual screens don't produce. If a future tour ever does target something behind a modal, that is a new decision, not one to guess at now. |
| 3.10 | **Mobile styling reuses the existing design language wholesale**: the tour step "card" uses the same `bg-surface border border-line rounded-[3px]` shell as other panels, `min-h-11`/`min-h-12` buttons, the same `text-[15px]`/`text-base` body copy sizes already used in `WelcomeBanner` and `Modal`. Positioning clamps to the viewport and flips above/below/beside the target based on available space; below `sm`, if a step's target is in the sticky header (month/funding-source selectors) or the sticky nav, the step card docks to the bottom of the viewport instead of trying to float near a target that may be scrolled partly off-screen. | "Must look right on a phone" is only achievable by matching the one design language the rest of the app already commits to, not inventing tour-specific visual rules. Docking to the bottom for header/nav targets sidesteps the hardest single mobile positioning case (a tooltip pointing at something in a `position: sticky` bar at the very top of a short viewport) rather than trying to solve general arbitrary-position clamping perfectly on the first pass. |

---

## 4. Data model

```ts
// src/db/schema.ts

export const tourKey = pgEnum("tour_key", [
  "dashboard",
  "add_expense",
  "recurring",
  "packet",
]);

/** Per-user "have they seen this tour" record (Phase 7, D-94). One row per tour actually
 *  finished or skipped — both count as "seen" (Appendix A: "Skipping or finishing means it
 *  doesn't show again"). No row = not yet shown. Deleting a user's rows (Settings' "Show the
 *  app guide again") re-arms every tour on that user's next visit to each tab. */
export const userTourProgress = pgTable(
  "user_tour_progress",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tour: tourKey().notNull(),
    completedAt: createdAt(), // reuse the existing `createdAt()` builder as "when marked seen"
  },
  (t) => [primaryKey({ columns: [t.userId, t.tour] })],
);
```

Migration is purely additive: one new enum, one new table, no changes to any existing table.
No backfill needed — every existing user simply has zero rows, which means every existing user
sees every tour once on their next visit to each tab. That is almost certainly the right
behaviour (the tours teach real, currently-invisible rules — showing them once to existing users
too is a feature, not a regression), but confirm with the product owner before shipping (Open
Question 3).

---

## 5. Server actions

`src/modules/tours/actions.ts` (new module, mirrors the shape of `dismissWelcomeAction`):

```ts
"use server";

export async function completeTourAction(tour: TourKey): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  await db.insert(userTourProgress)
    .values({ userId: current.userId, tour })
    .onConflictDoNothing();
  return ok(); // no revalidatePath — the tour's own client state hides it immediately;
               // the DB write only has to win the race against a page refresh or a second tab.
}

export async function resetToursAction(): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  await db.delete(userTourProgress).where(eq(userTourProgress.userId, current.userId));
  revalidatePath("/", "layout"); // Settings' own page doesn't need the tours, but the *next*
                                  // tab the user opens does — this forces a fresh server read.
  return ok();
}
```

`src/modules/tours/queries.ts`:

```ts
import "server-only";

export async function hasSeenTour(userId: string, tour: TourKey): Promise<boolean> {
  const [row] = await db.select({ tour: userTourProgress.tour })
    .from(userTourProgress)
    .where(and(eq(userTourProgress.userId, userId), eq(userTourProgress.tour, tour)))
    .limit(1);
  return row !== undefined;
}
```

---

## 6. Component architecture

- **`src/components/ui/tour.tsx`** — the engine, one component: `<TourGuide tour={TourKey}
  steps={TourStep[]} alreadySeen={boolean} />`. A `TourStep` is `{ target: string | string[]
  (tried in order, first match wins), title, body, placement?: "auto" | "bottom-sheet" }`.
  Internally: on mount, if `alreadySeen`, render nothing. Otherwise resolve the step list by
  filtering out (not blocking on) any step whose every candidate target is absent from the DOM
  at that moment (decision 3.6), then walk the user through the remaining steps with Next /
  Back / Skip. Finish or Skip both call `completeTourAction(tour)` once (*since D-132, Skip calls `skipAllToursAction()` instead, marking every tour*), client-side, then
  unmount.
- **Four thin per-screen configs**, each just a `TourStep[]` constant with the exact copy from
  Appendix A — not logic. E.g. `src/modules/tours/dashboard-tour.ts`,
  `add-expense-tour.ts`, `recurring-tour.ts`, `packet-tour.ts`.
- **Mounted from each page's own client boundary**: the Dashboard page, the Add Expense *new*
  page only (not edit — Appendix A is explicit: "Show the tour only when adding a new expense"),
  the Recurring page, and the Packet page's non-`PickFundingSource` branch. Each page's Server
  Component calls `hasSeenTour` once and passes the boolean to a small client wrapper that
  renders `<TourGuide>`.
- **`data-tour` attributes** added in this build to: `month-selector` and
  `funding-source-selector` wrappers in `app/r/layout.tsx`; the "Add Expense" `<Link>` in
  `app-nav.tsx`; the Closing Balance `<th>` in the Dashboard table heading; `name`,
  `description`, the `subtotal`/`tax`/`fees` field group, the reimbursable-amount box, the proof
  `<UploadField>`, and the receipt `<UploadField>` + "No receipt available" label in
  `expense-form.tsx`; the per-row "Add to {month}" button and the empty-state "+ Add recurring
  item" button in `recurring-manager.tsx`; the "Documentation Complete" `<th>`, the blocking
  alert container, the "Month documents" heading, the two download buttons, and "Mark as
  submitted" in the packet screen's files.
- **Settings**: one new row in the Account section (`app/r/settings/settings-sections.tsx`,
  `AccountSection`) — a plain button, "Show the app guide again," calling `resetToursAction()`
  through the same `run()`/toast pattern every other Settings action already uses.

---

## 7. Open questions — decide before or during Phase 0

1. **Tour engine: bespoke, or a small dependency?** Recommendation: **bespoke** (§3.4/§6), given
   the ladder in this project's own working rules (reuse before adding a dependency) and given
   that the actual engineering surface is genuinely small once scoped to exactly four short,
   linear tours with no branching logic beyond "does this element exist" — not a general-purpose
   tour framework. If, once the mobile positioning work in Phase 0 is underway, viewport-aware
   placement turns out to need materially more code than expected, revisit with a concrete
   library recommendation (e.g. `driver.js` — framework-agnostic, no React-version coupling,
   ~5KB) rather than defaulting to one now.
2. **Does a tour block interaction with the rest of the page**, or can the user click around
   while it's open (with the tour just following)? Recommendation: **blocks** — `inert` on
   everything except the highlighted target and the tour's own controls, matching how a first-run
   walkthrough is expected to behave (the user reads the four/six/two/five steps in order; a
   tour that can be silently defeated by clicking elsewhere isn't teaching anything). Skip is
   always one tap away, which is the actual escape hatch the spec asks for.
3. **Do existing users (signed up before this ships) see all four tours on their next visit to
   each tab?** Recommendation: **yes** (§4) — flag for explicit confirmation before deploy, since
   it's a real behaviour change for people already using the app, not just new sign-ups.
4. **If the user navigates away mid-tour** (clicks a nav tab before finishing), does the tour
   resume where it left off on return, or start over from step 1? Recommendation: **start over,
   don't persist mid-tour position** — nothing is written to `user_tour_progress` until Finish
   or Skip (§3.3), so a user who bails out mid-tour without hitting Skip will see it again next
   visit, which is the same as never having engaged with it. Simpler than persisting a step
   index, and consistent with "the whole tour is short."
5. **Exact copy of Recurring step 1's target label** when it falls back to "+ Add recurring
   item": the spec's own text ("Nothing is added automatically. Press Add for each bill or
   salary you want in this month.") reads slightly oddly pointed at a button literally labelled
   "+ Add recurring item" rather than "Add." Confirm the copy stays exactly as given regardless
   of which button it lands on, or wants a second sentence variant for the fallback case.

---

## 8. Phased build plan

Each phase ends green: `npm run typecheck`, `npm run lint`, full `npm test` (integration tests
running, not skipped — see the `DATABASE_URL` note in `docs/PHASE-6.md` §0 item 5, same rule
applies here). One commit per phase, matching this repo's commit style (`git log -8` first).

### Phase 0 — Engine, data model, and the Dashboard tour (simplest, proves the shape)
- Migration: `tour_key` enum + `user_tour_progress` table.
- `src/modules/tours/{actions,queries}.ts`, `src/components/ui/tour.tsx`.
- `data-tour` attributes for `month-selector`, `funding-source-selector` (`layout.tsx`), the
  "Add Expense" nav link (`app-nav.tsx`), the Closing Balance column header.
- Dashboard tour wired up, all 4 steps, including the conditional funding-source step (test
  against both a single-source and a multi-source dev org).
- Tests: `hasSeenTour`/`completeTourAction`/`resetToursAction` integration tests (two-org /
  two-user isolation, matching the pattern in `src/modules/funding-sources/queries.integration.test.ts`);
  a unit test for the engine's "skip a step whose target is absent" logic; a manual/Playwright
  check that a brand-new sign-up sees the Dashboard tour once and never again after Finish, and
  again after Skip.

### Phase 1 — Add Expense tour
- `data-tour` attributes across `expense-form.tsx` for all 6 targets (§6).
- Wired into the *new*-expense route only; confirm the *edit* route never mounts it.
- Test: new vs. edit distinction; all 6 steps present in order on a fresh org with an empty
  vendor library and no attached documents (the state a truly new user is actually in).

### Phase 2 — Recurring tour
- `data-tour` attributes for both button targets in `recurring-manager.tsx`.
- Fallback-target logic exercised against both an empty recurring list and a populated one.
- Test: both branches of the fallback.

### Phase 3 — Month-End Packet tour
- `data-tour` attributes across the packet screen's files.
- Gate on a single source resolved (§3.7); conditional step 2 tested both with and without a
  blocking expense present.
- Test: the "All sources selected → tour does not start" case; the conditional alert step
  present/absent case.

### Phase 4 — Settings replay, polish, docs
- "Show the app guide again" button in `AccountSection`.
- Mobile pass on all four tours at a phone viewport width (the design review the client asked
  for) — dock-to-bottom behaviour for header/nav-anchored steps (§3.10).
- Docs: this file's Results section; `docs/03-modules/m00-app-shell-auth.md` (new tour section,
  mirroring how the funding-source selector was documented there); `docs/01-domain/data-model.md`
  (new table); a new decision entry **D-94** in `docs/04-engineering/decisions.md` once the
  Open Questions above are actually settled, not before.

---

## Results (2026-09-14)

All five phases shipped, one commit each (`2fbff03`…Phase 4). Open questions settled as built,
recorded as **D-94** in `docs/04-engineering/decisions.md`:

1. **Bespoke engine** (§7 Q1) — built, no dependency added. The mobile positioning work did not
   need more than the recommendation anticipated; one real bug was found and fixed along the way
   (see below), not a sign the approach was wrong.
2. **Blocks interaction** (§7 Q2) — built as recommended: `inert` on everything but the
   highlighted target and the tour's own controls, Skip always available.
3. **Existing users see all four tours** (§7 Q3) — yes, confirmed: `hasSeenTour` has no
   sign-up-date gate, so anyone without a `user_tour_progress` row sees the tour on next visit to
   that tab, existing users included.
4. **Navigating away mid-tour starts over** (§7 Q4) — built as recommended; nothing is written
   until Skip or Finish.
5. **Recurring step 1's fallback copy** (§7 Q5) — kept exactly as spec'd, unchanged, for both the
   literal empty-list case and the "every item already added" case (the fallback triggers
   whenever no per-row "Add to month" button is present, which is a slightly wider condition than
   "list empty" — see D-94).

**A real bug, caught and fixed (Phase 2):** the card-positioning logic's "place below" heuristic
required only 180px of space, but the card itself runs 220–260px tall; on Recurring's short,
mostly-empty page this let the card render off the bottom of the viewport. Fixed with an
`ESTIMATED_CARD_HEIGHT` constant driving both the below/above choice and a hard viewport clamp,
plus a `max-h`/`overflow-y-auto` backstop on the card itself. Reproduced before the fix,
reverified after, with a screenshot showing the card and both buttons fully on-screen.

**Verified live, end to end** (2026-09-14, fresh browser session): completed/skipped all four
tours as one user, confirmed via direct DB query that all four `user_tour_progress` rows existed
for that user only; clicked "Show the app guide again" in Settings, confirmed via DB query that
all four rows were deleted; revisited Dashboard and confirmed the tour re-armed at step 1 of 4.
Also re-verified the Packet tour does not mount while "All funding sources" is selected, and that
it starts cleanly once a single source is chosen. Full mobile pass (390×844) across all 21 steps
of the four tours (Dashboard's 4, Add Expense's 6, Recurring's 2, Packet's 5) — every card stayed
on-screen with no overflow, Skip/Back/Next/Done all reachable at that width.

**Not independently proven:** a genuine multi-device scenario (two real separate sessions/browser
profiles for the same user) — the "stays gone on another device" guarantee rests on the tour
being a plain server-rendered read keyed by `user_id`, which the Phase 0 integration test
exercises via two independently-resolved sessions for the same user, but no literal second
physical device was used.

Test suite: 802 passed, 20 skipped, one unrelated pre-existing failure
(`packet-trace.integration.test.ts`, caused by a local `pdftotext` version mismatch producing its
usage help instead of running — an environment/tooling issue, not a regression from this work).

## 9. Acceptance criteria → where each is proven

| Criterion (Appendix A "Done when") | Proven by |
|---|---|
| New user sees the Dashboard tour right after setup | Phase 0 sign-up-to-Dashboard test |
| Add Expense / Recurring / Packet tours start on first visit to that tab | Phases 1–3 per-tour tests |
| Skipped or finished tours don't come back, including on another device | Phase 0's two-session/two-device-simulating integration test: complete via user A's session, resolve `hasSeenTour` via a second independently-resolved session for the same user |
| "Show the app guide again" replays all tours | Phase 4 test: reset, then confirm all four `hasSeenTour` calls return false again |
| Conditional steps appear only when relevant | Phase 0 (funding source step), Phase 2 (Recurring fallback), Phase 3 (blocking-alert step, All-sources gate) |
| Every step reads well on phone, tablet, desktop | Phase 4 manual/Playwright viewport pass |

---

## Appendix A — Product spec (verbatim, 2026-09-14)

The app is used by non-technical programme staff on phones and laptops. The PRD promises it is
"usable by non-technical staff without training beyond a walkthrough". Today the only first-run
help is a one-line banner on the Dashboard ("Your budget is set up. Add your first expense to
get started.").

Most screens are self-explanatory. A few are not, because they carry rules that are invisible
until something goes wrong: a month selector that changes the whole app, an expense form where
every field ends up printed on a document for the City, and a month-end screen that blocks
downloads. These are the only places this ticket adds guidance.

### Goal

After a new user signs up and finishes the setup steps, guide them through only the confusing
parts of the app. Each tour is short, shows once, and can be skipped.

We are **not** adding a tour to every tab or every field.

### Where the tour guide goes

There are four short tours, one per tab. Each tour starts the first time the user opens that
tab, not all at once.

**1. Dashboard tab (4 steps)** — starts on the user's first visit to the Dashboard after setup.
1. Month selector at the top. "This is the month you're working in. Every tab follows it,
   including expenses, cover sheets and the packet."
2. Funding source selector at the top. Show this step only if the organisation has more than one
   funding source. "Each funding source has its own budget, expenses and packet. Pick one, or
   choose All to see them side by side."
3. Closing Balance column in the budget table. "This turns red when a line item has less than
   10% of its budget left, or is overspent."
4. Add Expense tab. "Add each expense when it happens, with its receipt. Then month-end takes
   minutes."

**2. Add Expense tab (6 steps)** — the most complex screen. Show the tour only when adding a new
expense, not when editing one.
1. Name field. "Start typing. Vendors you've used before fill in the rest of the details for
   you."
2. Description / role field. "This exact text prints on the cover sheet the City reads, so write
   it the way it should appear."
3. Subtotal, Tax and Fees. "Enter the amounts from the receipt. If there's tax or fees, you'll be
   asked whether the funder pays for them."
4. Reimbursable amount box. "This is the amount being claimed. Anything not reimbursed is noted
   on the cover sheet."
5. Proof of payment upload. "Always required. Add a bank transaction or payment screenshot.
   Without it, the month's packet can't be downloaded."
6. Receipt upload and the "No receipt available" option. "Add the receipt, invoice or timesheet.
   If there isn't one, tick No receipt available and give a reason. The reason prints on the
   cover sheet."

**3. Recurring tab (2 steps)**
1. The "Add to month" button on an item. If the list is empty, use the "Add recurring item"
   button. "Nothing is added automatically. Press Add for each bill or salary you want in this
   month."
2. An item already added to the month. "Added items still need their proof of payment. Open each
   one from the Expenses tab to attach it."

**4. Month-End Packet tab (5 steps)**
1. Documentation Complete column. "Every line item needs a Yes here before you can download."
2. The red "cannot be downloaded yet" message. Show this step only when that message is on
   screen. "These expenses are missing a document. Open expense takes you straight to the fix."
3. Month documents section. "Bank statements, timesheets and the fiduciary invoice go here.
   They're optional and never block a download."
4. Download buttons. "Download the packet PDF for signing and the Excel summary."
5. Mark as submitted. "Mark the month as submitted once it's sent. You can still correct it
   later."

If "All funding sources" is selected, this tab asks the user to choose one source first. Don't
start the tour until a source is chosen.

### Tabs with no tour

Sign up and the setup steps; Expenses; Cover Sheets; Contract Summary; Line Items; Settings.

### How it should behave

- Every user sees each tour once. This includes staff added later, not just the person who
  signed up.
- The user can skip a tour at any time. Skipping or finishing means it doesn't show again.
- Once a tour is done, it shouldn't reappear when the same user logs in on another device, like
  their phone.
- Settings has a "Show the app guide again" option that brings all the tours back.
- The tours must look right and be easy to tap on a phone.
- Keep the existing welcome message on the Dashboard.

### Done when

- A new user who signs up sees the Dashboard tour right after setup.
- The Add Expense, Recurring and Month-End Packet tours each start on the first visit to that
  tab.
- Skipped or finished tours don't come back, including on another device.
- "Show the app guide again" in Settings replays all tours.
- Steps that only apply sometimes, like the funding source step or the "cannot be downloaded"
  step, appear only when relevant.
- Every step reads well on phone, tablet and desktop.
