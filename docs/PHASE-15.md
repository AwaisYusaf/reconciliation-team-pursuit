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

_Filled in as each task lands._
