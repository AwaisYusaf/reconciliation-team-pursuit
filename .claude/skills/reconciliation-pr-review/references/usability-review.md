# Usability review — the third half of every review

The people using this app are not technical: Misty and her team reconcile grant expenses; they
are not software users by trade. A PR can meet every "Done when" line and still be hard to use.
Awais's rule (2026-09-18): **do every operation in fewer, easier steps, so the user does not need
to think.** Reviews may ask for any change that serves that, even when the ticket was followed —
moving a page, reordering sections, removing a step, renaming a button.

Do this pass in the browser, doing the real task as the user would (not by reading code), at
desktop and at 375 px. Report each item as a **usability ask**: what the user experiences, why it
costs them, and a concrete proposal. When it changes what the ticket said, it goes to Awais as a
choice (with a recommendation), not to the developer as a fix.

## Checklist

1. **Findable where they already work.** Can the user reach the feature from the screen where the
   task starts (Add Expense, Month-End Packet, Dashboard)? A screen reachable only through a small
   card or a link on another tab will not be found. Prefer the place the ticket named, or the
   navigation.
2. **Fewest steps.** Count clicks for the main task. Anything that is always done next should be
   offered right there (a "Download" beside the finished thing, not on another tab). No step that
   exists only because of how the code is built.
3. **Plain words, no machinery.** No raw Markdown (`##`, `**`), ids, enum names, "Plus"/plan
   jargon where the plan name is "Reconciliation + AI", error codes, or developer terms. Button
   labels say what happens ("Use these amounts", "Download Word").
4. **One clear next action.** Each state shows what to do next. A disabled button says why. An
   empty state says how to fill it.
5. **Warnings mean something.** A warning must be true and actionable. False alarms (e.g. a
   matching bank line flagged as a mismatch because of its minus sign) teach users to ignore
   warnings. Style by severity: danger red only for real problems; informational reminders in a
   calm style; never two red boxes stacked for routine notes.
6. **Main content first.** The thing the user came for sits at the top; lists of past items,
   history and help go below — especially at 375 px, where anything above the fold pushes the
   work off screen.
7. **Same thing looks the same.** One layout per form where possible; if a plan or setting changes
   field order, check the user switching plans isn't lost. Terms match across screens, tours and
   documents.
8. **Recoverable.** Destructive or expensive actions confirm with plain consequences; the user can
   undo or copy their text first; unsaved work is never lost silently.
9. **Speed feels acknowledged.** Anything over ~1 s shows progress in words ("Reading 2
   documents…"); nothing looks frozen; the rest of the page stays usable.
10. **Phone.** No sideways scroll, tap targets ≥ 44 px, dialogs fit, the main button is reachable.

## Report shape

Under a heading **Usability asks**, numbered, each: *what the user sees* → *why it costs them* →
*proposal* (and "needs Awais's choice" when it departs from the ticket). Put the strongest two in
the Slack draft; leave the rest for Awais to pick.
