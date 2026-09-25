# Mobile app: the full application on iOS and Android

The application does everything a grant reconciliation needs: expenses, budgets, month end
packets, cover sheets, summaries and the settings behind them. All of it is on the web today.

This plan puts every one of those features on a phone and a tablet, as one React Native app for
both iOS and Android.

## How it fits together

The app holds no calculations, no budget rules and no database of its own. It asks the web
application for everything and displays the answer.

The web application reads and writes the same database it does today. An expense recorded on a
phone is the same row as one typed on the website, in the same month, under the same rules.

The work therefore splits in two. The website needs a front door, because it has none. The app
is then built against that front door.

---

# Part 1. Changes to the web application

All of it is additive. Existing screens and behaviour are not changed.

## 1.1 The shape of the problem

The website has 68 server actions across 13 areas, and 14 file addresses. The actions are the
writes: save an expense, approve a draft, lock a month, change a plan. They are not reachable
from outside the website, because they are wired into its own pages rather than published as
addresses.

Full feature parity means publishing all of them. That is the bulk of Part 1 and it should be
understood before it is agreed.

## 1.2 Sign in for the app

The website keeps people signed in with a browser cookie. Phones do not handle cookies well, so
the app is given a key instead.

The key uses the same sessions and the same revocation the website already has, so removing
someone's access removes it everywhere at once. The app is also told the oldest version still
supported, so an out of date install can be asked to update.

One change carries this: the shared session reader. Every action already passes through it, so
once it understands a key as well as a cookie, the existing code works unchanged behind the new
addresses. This is what keeps the rest of Part 1 to wrapping rather than rewriting.

## 1.3 The addresses, by area

Each one is a thin wrapper over an action or query the website already runs. No rule is written
twice.

| Area | Addresses | Covers |
|---|---|---|
| Sign in and account | 8 | Sign in, sign out, sign up, onboarding, password, profile photo |
| Expenses | 8 | Create, edit, delete, restore, permanently delete, history, vendor search |
| Invoice drafts | 7 | Read an invoice, update, approve, approve all ready, discard, undo |
| Dashboard and contract | 3 | Budget position, the month's figures, contract summary |
| Line items | 6 | Create, edit, reorder, delete, budgets |
| Recurring items | 4 | Create, edit, delete, add to a month |
| Month end packet | 4 | The packet's figures, lock, unlock, mark submitted |
| Cover sheets | 2 | The sheet for a line item, and its proofs |
| Monthly summary | 2 | Write, save |
| Sharing | 4 | Create, update and revoke a share link |
| Settings | 7 | Organization, funding sources, lists, vendors, AI switch |
| Users | 7 | Invite, edit, revoke access, delete |
| Staff area | 4 | Directory, plan, complimentary access, suspend |
| Walkthroughs | 3 | Mark seen, reset |

The 14 file addresses that already exist, for uploads and for downloading the packet, the Excel
summary and cover sheets, need only the new sign in.

## 1.4 The supporting pieces

- **A version number in every address.** Installed apps are not updated on demand, so old
  versions stay in use for months after a change. Building this in now costs nothing and cannot
  be added afterwards.
- **One error format**, so every failure reaches the app in the same shape and is reported in
  the same way.
- **A limit on sign in attempts.** A plain sign in address is easier to attack than a form.
- **Tests to the standard of the rest of the application.** Every address restricted to the
  caller's own organization, proven by a test that fails if the restriction is removed.
- **A written record of the decision**, kept with the project's other decisions.

## 1.5 Files that change

| File | Change |
|---|---|
| `src/services/auth/session.ts` | Accept a key as well as a cookie. The one change everything else rests on |
| `src/modules/auth/actions.ts` | Lift the body of sign in into a plain function the new address can call |
| `src/lib/api-response.ts` | New. Turns an action's result into a response, one way, once |
| `app/api/mobile/v1/**` | New. The addresses above, each a wrapper |
| `docs/04-engineering/decisions.md` | The decision, written down |

Not touched: the database, `proxy.ts`, and every existing screen.

---

# Part 2. The mobile app

React Native, one codebase for iOS and Android, in its own repository. Laid out for a phone, and
usable on a tablet where the wider screens are easier.

## 2.1 Every feature, and how it lands on a phone

| Feature | On the phone |
|---|---|
| Dashboard | The month's figures and the spend chart, stacked instead of side by side |
| Add an expense | The full form, with the camera for the receipt |
| Expenses | The month's list, search and filters, edit, delete, restore from trash, history |
| Add from invoice | Upload, read, then the draft queue: check, edit, approve, approve all ready |
| Line items | The list, budgets, add, edit, reorder, delete |
| Recurring items | The list, add to the month, edit, delete |
| Month end packet | Its figures, what is missing, lock, unlock, mark submitted |
| Downloads | Packet, Excel summary and cover sheets open in the phone's own viewer, and can be shared or saved from there |
| Share links | Create, see, update and revoke |
| Cover sheets | Viewed per line item, with their proofs |
| Monthly summary | Write, read and edit the saved summary |
| Contract summary | The contract's figures and the position table |
| Settings | Organization, funding sources, lists, vendor library, users, account and photo |
| Staff area | The organization directory and the account controls, for AB Solutions staff |
| Walkthroughs | The same first run guidance |

## 2.2 Where a phone is honestly different

Three things do not simply shrink, and are called out so they are not a surprise.

**Wide tables.** Expenses, line items and the packet have many columns. On a phone each row
becomes a card with the figures stacked, rather than a table scrolled sideways. The same
information, laid out for the screen.

**Documents.** The packet, the Excel summary and the cover sheets are available on the phone in
full. They are produced by the website, exactly as they are today, and the phone opens the
finished file in its own viewer to read, share or save.

They are not built on the device, for three reasons. The tools that make them are server
software and do not run on a phone. The packet is an assembly rather than a document, merging
every receipt and proof stored for the month, so building it on the phone would mean
downloading all of them first. And this file is what the funder receives: if the phone produced
its own version, any difference between the two would mean the app shows one document and the
funder is sent another.

**Long writing.** The monthly summary is a document people write paragraphs into. It works on a
phone and is better on a tablet. Editing it is supported; nobody should be expected to draft it
on a phone.

## 2.3 Rules

The same rules as the website, because it is the same system underneath.

- **Who can do what:** admins and managers keep exactly the permissions they have today. The
  staff area stays restricted to AB Solutions staff.
- **Locked month:** the same refusals, with the same wording.
- **Archived funding source:** cannot be used, as on the website.
- **Plan features:** invoice reading and the monthly summary follow the same plan and the same
  setting as they do on the web. When they are off, they are not shown.
- **Access:** removed on the website, removed on the phone at once.

## 2.4 No signal

The app needs a connection. If there is none it says so plainly, and a form keeps what has been
typed so it can be saved when signal returns. Nothing is silently lost.

---

# Steps

| Phase | What | Finished when |
|---|---|---|
| 1 | The front door: sign in, the error format, and the addresses in 1.3 | The whole website can be driven from a terminal |
| 2 | The shell: repository, sign in, navigation, the month's list | A person signs in and sees their month |
| 3 | Daily work: expenses, the camera, drafts, recurring, line items | The everyday job is done entirely on a phone |
| 4 | Month end: packet, cover sheets, summaries, downloads, sharing | A month can be closed from a phone |
| 5 | The rest: settings, users, staff area, walkthroughs | Parity |
| 6 | Release: developer accounts, builds, internal testing, submission | Live in both stores |

Phases 1 and 3 carry most of the work. Apple review takes days and sometimes rejects a first
submission, so Phase 6 is not a same week step.

---

# Not part of this

- **Working offline.** It needs a store on the device, a queue of unsent changes and a rule for
  what happens when one lands in a month that has since been locked. It is a project of its own,
  and it would end the approach this plan depends on, where the phone holds no logic.
- **A second set of rules.** Anything the app displays is calculated by the website. If a figure
  is wrong, there is one place it comes from.

# Done when

- A person signs in on iOS or Android with the same account they use on the website.
- Every feature listed in 2.1 is usable on a phone.
- An expense recorded on a phone appears on the website at once, indistinguishable from one
  typed there, and the reverse.
- The same fields are required as on the website, with the same messages when one is missing.
- Locked months, archived funding sources, permissions and plan features behave identically.
- The packet, the Excel summary and the cover sheets open and can be shared from the phone.
- Removing a person's access stops their phone working immediately.
- No connection is reported plainly, and nothing typed is lost.
- No figure shown in the app is calculated by the app.
