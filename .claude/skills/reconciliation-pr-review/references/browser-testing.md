# Browser testing a PR locally

## Getting a running app
- `:3000` on this Mac usually belongs to a different project (check with
  `lsof -iTCP:3000 -sTCP:LISTEN` and the process cwd). Don't stop it.
- Next.js allows **one dev server per project folder**. If the user already runs one (they use `:3001`),
  test on theirs. Otherwise start `ngo-expenses-3100` from `.claude/launch.json` with the Browser
  pane's `preview_start`. Clearing `.next/dev` stops a running dev server — tell the user.
- The dev server serves the checked-out branch against the local DB (already migrated by setup).

## Signing in
- Do not create sessions in the database or type passwords; the permission system blocks it anyway.
- Ask the user to sign in. Prefer **Claude in Chrome** (`mcp__claude-in-chrome__*`) when the user says
  the extension is installed — their Chrome login is used. Otherwise ask them to sign in inside the
  in-app Browser pane (it has its own cookies, separate from their Chrome).
- Cookies are per host, not per port: a login on `localhost:3001` also applies to `localhost:3100`
  in the same browser.

## Driving the UI reliably
- Clicks and typing that land before hydration are silently dropped; the form may even reset. After a
  navigation, wait ~3s, and if a click "does nothing", retake a screenshot and click by coordinates
  before calling it a bug. Two earlier "bugs" on this project were exactly this.
- The shared `Select` is a custom combobox: open it with a click then `ArrowDown`; read options with
  `[...document.querySelectorAll('[role=option]')].map(o => o.textContent.trim())`; choose with
  `Home`/`End`/arrows + `Enter`.
- Batch predictable steps with `browser_batch`.
- After every state-changing step, confirm in the DB with a read-only `psql` query. Screens can look
  right while the stored state is wrong (and the other way round).
- The header month and funding-source selections are **stored per organisation**, shared by every user
  and tab of that org — another session can change them under you. If a selection "resets", check
  `organizations.active_*` and whether the user is active in parallel before reporting.

## What to cover
1. The existing client's view: nothing changed that the ticket did not ask for (figures, selectors,
   forms, document names).
2. Each user-visible acceptance criterion from the ticket, on real local data.
3. The negative paths: forbidden role, archived/foreign ids (e.g. `fetch('/api/downloads/packet?month=…')`
   without or with a bad `source` → 404, not 500), post-save redirects landing where the record is visible.
4. Leave test data only in a test org (the local "Mantaq" org), prefix names with "Review", and list
   what you created in the report.
