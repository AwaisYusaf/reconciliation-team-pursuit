# m12 — Feature requests

## Purpose
Customers suggest a feature, an improvement or an idea from inside the app, as plain text, see
what other organizations have asked for once our team approves it, and add their vote with
"I want this too". Our team reads every request in `/a`, replies below it, rewords it if needed
and sets its status. Nothing is emailed; staff check `/a`.

## Scope
Routes `/r/feature-requests` (the list) and `/r/feature-requests/[id]` (one request), reached from
the avatar menu's **Feature requests** item, between Your profile and Sign out. Admins and managers
alike, on every paid plan, complimentary included; an organization without a paid plan reaches
only the plan chooser and has no item. No top navigation tab and no tour. The staff side is m10's
Feature requests section. Full design, decisions and tests: `docs/PHASE-17.md` (the ticket is its
Appendix A); the cross-organization rules are D-127.

## Data
`feature_requests`, `feature_request_votes`, `feature_request_replies` (`data-model.md`). Customer
reads are `src/modules/feature-requests/queries.ts`: `loadFeatureRequestList(viewer, {tab, q})` and
`loadFeatureRequest(viewer, id)`, both through the one visibility predicate `visibleTo`. Another
organization's request is loaded as its title, details, status and votes only
(`PublicFeatureRequest`); its own organization also gets the author, the status's meaning, whether
it is shown to all, and the replies (`OwnFeatureRequest`). Pure rules and URL helpers:
`src/domain/feature-requests.ts`. Copy: `UI.featureRequest*`, `FEATURE_REQUEST_STATUS_LABELS` and
`FEATURE_REQUEST_STATUS_DESCRIPTIONS` in `src/domain/strings.ts`.

## Behavior
- **List.** Title, the intro line and **Suggest a feature**; then the two tabs and the search box,
  all in the URL (`?tab=org&q=`). **All requests**: every request shown to all plus this
  organization's own, most votes first, then newest. **From your organization**: only this
  organization's, waiting ones included, **newest first** (PHASE-17 Q1), so a request just sent is
  at the top. Search is a GET form (Enter or Search, no typing delay) matching every word in the
  title or details; never the original wording. At most 100 rows, then "Showing the first 100.
  Search to find others."; no pages. Empty states for each tab and for a search with no match.
- **Row.** The title (the link, carrying the tab and search as `?back=`), the details cut to two
  lines, "Status · N votes · Suggested date", the vote button while voting is open. This
  organization's rows carry "Your organization", "Our team replied" when our team wrote last, and,
  while other organizations can't see them, "Only your organization can see this until our team
  reviews it." (waiting) or "Only your organization can see this." (any other status, Q4). Another
  organization's row never says whether it has replies.
- **I want this too.** One vote per person, set rather than toggled; pressing again takes it back
  and the button reads "You want this" while voted. The person who suggested a request has the
  first vote and can take it back. No button on Released, Not planned or Already requested (Q3);
  their votes still show.
- **Suggest a feature.** A dialog: "What would you like?" (required, up to 100 characters, one
  line) and "Tell us more" (required, up to 2,000). Cancel keeps what was typed; every refusal shows
  in the dialog. Sent: the toast "Thanks. Your request was sent to our team.", then the From your
  organization tab. At most ten a day per person on the America/Detroit day; the eleventh gets
  "You've sent a lot of requests today. Please try again tomorrow."
- **One request.** A back link to the list the reader came from. Its own organization sees the
  title, details, status and what it means, votes, "Suggested by {name} on {date}" (no name once
  that account is removed), the replies oldest first (our team's signed "Stay Funded 360 team",
  never a person's name) and an **Add a reply** box (up to 2,000 characters), on any status.
  Another organization sees the title, details, status, votes and the vote button, nothing else. A
  request this organization can't see, and an unknown or malformed id, are the same 404.
- **Plain text.** Typed line breaks are kept; nothing becomes a link; long words and addresses wrap
  rather than widening the page. No live updates: new requests, votes and replies appear on reload.

## Server surface
`src/modules/feature-requests/actions.ts`, each behind `actionSession()` (paid and complimentary):
- `suggestFeatureAction({ title, details })` — the request and its author's vote in one
  transaction, under a per-person advisory lock that counts today's requests.
- `setFeatureRequestVoteAction({ requestId, want })` — visibility first, then whether voting is
  open; adds with `onConflictDoNothing`, or deletes.
- `replyToFeatureRequestAction({ requestId, body })` — this organization's own requests only;
  another organization's, shown or not, is refused like a missing one.

## Acceptance
Each "Done when" line of the ticket has an integration test in
`src/modules/feature-requests/feature-requests.integration.test.ts` (PHASE-17 §7), and each guard
a mutation that fails one: visibility until shown, never while waiting or already requested (the
database CHECK too), only title, details, status and votes for others (exact key sets), one vote
per person, search including a literal `%` and never the original wording, both tabs' order, ten a
day on the Detroit day with two sent at once, the same answer for hidden, random and malformed
ids, removed people's rows kept and organization deletes cascading.

## Claude Design prompt
None: built from the existing component kit (`PageHeader`, `Card`, `Modal`, `Field`, `Badge`,
`SegmentedLinks`, the Settings sidebar's pill), like m10 and m11.
