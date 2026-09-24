# Phase 15: PR #21 follow-ups (redesign, avatars, landing)

PR #21 (the app redesign, profile photos, account access and the landing page) merged on
2026-09-24 with items still open from four review rounds. This phase closes them on the same
branch (`Ui/Enhancements`) and ships as one new PR to `main`. The list is the one sent to the
developer in Slack on 2026-09-24, in that order.

**Out of scope, held for Awais and the client:** the landing page's product claims (plan limits
per funding source, "cryptographically logged / tamper-evident", the Ready Alerts / Ready Check /
Funding Trail wording, the sample AI memo) and the copy trims in e5ecaea. No landing *wording*
changes here; only structure, markup, accessibility and performance.

## Tasks

| # | Area | Task | Passing criteria |
|---|---|---|---|
| 1 | App | **Avatar upload hardening** (`app/api/me/avatar/route.ts`): same-origin check, a `Content-Length` cap before `formData()`, a rate limit, byte-level format check (JPEG/PNG/WebP only, SVG refused whatever it is labelled), re-encode to a 512px JPEG (strips EXIF/GPS, bounds size), count avatars in the storage quota, replace the old photo inside a transaction, and delete the photo when an account is deleted | An SVG labelled `image/png` is refused; a PNG with EXIF comes back without it; a cross-site POST is refused; the org's storage total includes the avatar; two racing uploads leave one object; a deleted account leaves no photo behind. Tests fail when each guard is removed |
| 2 | App | **`text-muted` paints nothing**: `--color-muted` was never defined, so 28 call sites render at full ink | Every `text-muted` becomes `text-sub`; computed colour is `#5b5147` |
| 3 | App + landing | **Focus ring invisible on dark surfaces** (nav pill 1.38:1, landing header 1.46:1, banner and footer 1.71:1) | Focus ring is at least 3:1 against every dark surface it can appear on |
| 4 | App | **Month selector cuts off the year** (`sm:w-[150px]`) | "September 2026", the longest value, fits at every width |
| 5 | App | **Tour resolver has no test** | Resolver logic is a pure function with tests; putting `querySelector`-first-match back fails them |
| 6 | App | **Stale comments in `app-header.tsx`** | Comments describe the code as it is |
| 7 | App | **First-visit Recurring tour opened ~5s late in testing**: find the cause | Cause identified; the tour opens as soon as its target is on screen, and a step is only dropped when its target is genuinely absent |
| 8 | DB | **Migration 0037 has no `lock_timeout`** | 0037 opens with `SET LOCAL lock_timeout = '5s'`, like its siblings |
| 9 | Docs | **`deactivated_at` undocumented; `design-language.md` contradicts the redesign** | Data-model row and D-row for account access; design-language.md matches the code (paper, type, table header, gradients, nav, 44px rule) and the redesign's aesthetic is a D-row |
| 10 | Tests | **Five integration test files leave fixture rows behind** | Each cleans up in `afterAll`; a full run leaves no fixture organisations |
| 11 | App + DB | **Users page joins all of `expense_audit_events` to count** | `exists` instead of `count ... group by`; index on `actor_user_id` |
| 12 | Landing | **Headline leaves "ready.™" alone on a third line** | No single-word last line at 375, 1024, 1280, 1440, 1536 |
| 13 | Landing | **Offers have no billing period** | Each Offer has a `UnitPriceSpecification` with a monthly unit |
| 14 | Landing | **Prices typed in six places** | One `PLANS` constant supplies every price on the page and in the JSON-LD |
| 15 | Landing | **Unused Domine and Public Sans load on every page** | Removed from `app/layout.tsx`; no request for them on `/` or `/r` |
| 16 | Landing | **OG image is a 4.5 MB transparent laptop** | A real 1200×630 image, under 300 KB, with the product visible |
| 17 | Landing | **FAQ and mockup for screen readers** | Collapsed answers are `inert` with `aria-controls` pointing at them; the fake dashboard is `aria-hidden` |
| 18 | Landing | **Reduced motion** | Smooth scrolling and the pulsing dots are off under `prefers-reduced-motion: reduce` |
| 19 | Landing | **Smaller**: sub-12px real text, tap targets under 44px, `priority` → `fetchPriority`, hero `sizes`, the whole page is a client component | 12px floor outside the mockup; 44px targets on phone for the header CTA, footer links and FAQ rows; no `priority` props; the page is a server component with small client islands |

## Order

Database and security first (1, 8, 11), then app UI (2 to 7), then landing (12 to 19), docs last
(9) so they describe the finished code. One commit per task or per tightly related pair.

## Results

All 19 tasks landed, one commit per task or tightly related group. Gates at the end: typecheck
and lint clean, 170 test files / 2,186 tests passing with none skipped, production build green.
The local database is at migration `0040`.

| # | Result | Evidence |
|---|---|---|
| 1 | Done (D-119). `normaliseAvatar` decodes and re-encodes to a 512px JPEG; the route has `sameOrigin`, a 413 before `formData()`, the `avatarUpload` limit (30/hour/person), a quota check on growth only, and the replace under the org upload lock with the row locked. `users.avatar_bytes` (`0039`) is counted by `orgStorageBytes` and named by `objectStillReferenced`. Deleting an account removes the photo after commit | Every guard mutation-tested: removing the format sniff, EXIF strip, origin check, length cap, rate limit, quota check, growth-only charge, or the `users` arm of the storage union each fails a test; so does skipping the photo delete on account delete, and removing both locks fails the three-way race test every time. Browser: a real POST stores a 512×512 JPEG with its size recorded, an SVG as `image/png` gets a 400, DELETE clears it |
| 2 | Done. 28 `text-muted` → `text-sub` across 11 files | Former `text-muted` captions on the packet page compute to `rgb(91, 81, 71)` |
| 3 | Done. `:focus-visible` reads `--focus-ring`; `.surface-dark` sets it to `primary-fixed` (#FFDBCB, about 11:1 on `accent-dark`) on the nav pill and menu button, the table header band, the landing header, CTA banner and footer | Keyboard Tab onto the nav pill and the landing logo link: ring `rgb(255, 219, 203)`; rings on light surfaces stay `accent` |
| 4 | Done. Compact month pill 150px → 172px ("September 2026" needs 164px) | At 640, 768, 1024, 1280 and 1440: "September 2026" fits, both selectors on one line, no horizontal scroll |
| 5 | Done. `firstShown` in `resolve-steps.ts`, used by `tour.tsx`, with four tests | Dropping the size check fails two tests; dropping the rect check fails one |
| 6 | Done | Comments now say only the mark collapses, the account menu stays, the menu button takes over below `xl` |
| 7 | **Not reproducible, no code change.** With the Browser pane visible the first-visit Recurring tour opened 407ms after clicking the tab and 470 to 502ms after a direct load (dev mode). The ~5s in review was measured with the pane hidden, where the browser throttles animation frames and the tour's resolver runs on `requestAnimationFrame`. Step 1's target ("+ Add recurring item") is always rendered, so the resolver has nothing to wait for | Timings above; the spotlight box sits 12px around the visible "Add to" button |
| 8 | Done | Header added; all 40 migrations apply cleanly to an empty database |
| 9 | Done (D-120, D-121). `deactivated_at` row in the data model; design-language.md's tokens, type, cards, table header, nav, focus rule and Claude Design preamble match the redesign | Values checked against `globals.css`, `surfaces.tsx`, `table.tsx`, `app-nav.tsx` |
| 10 | Done. `afterAll` deletes the organisations (everything else cascades) and their `.storage` prefix in all five files | The fixture organisations matching those files' names: same count before and after a run |
| 11 | Done. `hasAuditHistory` is an `exists`; `expense_audit_events_actor_idx` (`0040`, lock timeout). **Also fixed:** `isForeignKeyViolation` missed Drizzle's wrapped error (`cause`), so the delete's race fallback crashed instead of refusing in words | `EXPLAIN` uses `Index Only Scan using expense_audit_events_actor_idx`. With the history check disabled, the old helper fails three tests and the fixed one passes them. Drizzle renders `users.id` bare inside the subquery, which silently matched the audit row's own `id`; the column is now qualified |
| 12 | Done. `text-balance` plus a no-break space in "staying ready." | At 320, 360, 375, 414, 640, 1024 and 1280 the second sentence never ends on one word |
| 13 | Done. `UnitPriceSpecification`, `unitCode: MON`, reference quantity one month | Parsed from the rendered JSON-LD |
| 14 | Done. `PLANS` in `src/modules/landing/plans.ts` feeds the cards, the AI section, the FAQ answer and the JSON-LD | No price literal left in `app/` or `src/modules/landing` |
| 15 | Done | Only Plus Jakarta Sans loads on `/` |
| 16 | Done. `public/og-image.jpg`, 1200×630, 64 KB, a render of the page's first screen | Served as `image/jpeg`; `og:image` and `twitter:image` point at it |
| 17 | Done. FAQ `aria-controls` + `inert` on collapsed answers; the mockup is `aria-hidden` and its fake `nav` is a `div` | Opening one answer clears `inert` on it and sets it on the rest |
| 18 | Done. Smooth scroll only under `no-preference`; `motion-safe:` on the pulse and ping dots; the reduced-motion rule adds `animation-iteration-count: 1`, since a looping animation cut to 0.001ms strobes instead of stopping | CSS read back from the page |
| 19 | Done. 21 lines of 10–11px text raised to 12px outside the mockup (four narrow card rows now wrap, and a pre-existing 320px overflow on the fiscal-year badge is fixed); 44px phone targets for the hero buttons, footer links, FAQ rows and (via a `::before`) the header CTA; `priority` gone (hero `loading="eager"` + `fetchPriority="high"`); hero `sizes` names its column; the page is a server component with `Reveal`, `LandingNav` and `FaqList` as client islands | Only the ™ superscripts measure under 12px; no clipped tile and no horizontal scroll at 320, 375, 768 or 1280. React's server renderer still emits image preloads for non-lazy images; that is React's own behaviour, not the deprecated prop |

**Left as found:** about 34 fixture organisations from earlier test runs are still in the local
database. They predate the cleanup and nothing removes them automatically.
