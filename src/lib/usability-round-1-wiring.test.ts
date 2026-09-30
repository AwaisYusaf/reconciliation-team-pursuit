/**
 * Usability round 1 (2026-09-29), batch "dashboard, packet, cover sheets, tours, plan wording,
 * AI screens": the screen-side wiring, read from source.
 *
 * This repo runs no jsdom/component-rendering tests (`vitest.config.mts`: `environment: "node"`),
 * so the pure rules are tested beside their helpers (`draft-rules`, `cover-sheet`,
 * `amount-suggestion`, `invoice-match`, `strings`, `read-invoice`, `sequence`) and this file pins
 * the conditions each screen puts around them, in the style of `screen.test.ts` and
 * `expense-form-upload-target.test.ts`. Comments are stripped first, so a sentence that
 * mentions a call can never satisfy a check meant for the code.
 */
import { describe, expect, it } from "vitest";

import { between, sourceCode as code } from "./source-code.test-helper";

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe("dashboard (app/r/page.tsx)", () => {
  const page = code("app/r/page.tsx");

  it("greets with Welcome, never Welcome back (AC1, E1)", () => {
    expect(page).not.toContain("Welcome back");
    expect(page).toContain("{greeting ? `Welcome, ${greeting}!` : \"Welcome!\"}");
  });

  it("shows the banner only while not dismissed AND the org has no expense (AC2)", () => {
    expect(page).toMatch(/\{!session\.welcomeDismissed && !hasExpense && \(\s*<WelcomeBanner[\s\S]*?\/>\s*\)\}/);
    expect(count(page, "<WelcomeBanner")).toBe(1);
  });

  it("does not ask the database once the banner is dismissed (E5), and asks with the session's own org", () => {
    expect(page).toContain("session.welcomeDismissed ? Promise.resolve(true) : orgHasAnyExpense(session.orgId)");
    expect(count(page, "orgHasAnyExpense(")).toBe(1);
  });

  it("shows the AI note only on an AI-entitled org, only inside the first-run banner, naming reading only while reading is on (AC4, E7, E8)", () => {
    expect(page).toContain("aiAllowedForOrg(session.orgId)");
    // Inside the banner's own condition, so it shows once, never as a tile on every visit.
    expect(page).toMatch(
      /\{!session\.welcomeDismissed && !hasExpense && \(\s*<WelcomeBanner\s+aiLine=\{aiOn \? \(readingOn \? UI\.dashboardAiIntro : UI\.dashboardAiIntroSummaryOnly\) : undefined\}/,
    );
    expect(page).not.toContain("<InfoNote");
    const banner = code("src/components/app-shell/welcome-banner.tsx");
    expect(banner).toMatch(/\{aiLine && \(/);
    // Once each: "UI.dashboardAiIntro" also starts "UI.dashboardAiIntroSummaryOnly".
    expect(count(page, "UI.dashboardAiIntro")).toBe(2);
    expect(count(page, "UI.dashboardAiIntroSummaryOnly")).toBe(1);
  });

  it("each Promise.all result lands in its own name: the banner reads the expense check, the AI note the plan (review)", () => {
    // Both are booleans, so swapping two entries would still typecheck.
    expect(page).toMatch(
      /const \[seenDashboardTour, readySummaryIds, hasExpense, aiOn, drafts, readingOn, lockedMonths\] = await Promise\.all\(\[\s*hasSeenTour\(session\.userId, "dashboard"\),\s*loadReadySummarySourceIds\([\s\S]*?\),\s*session\.welcomeDismissed \? Promise\.resolve\(true\) : orgHasAnyExpense\(session\.orgId\),\s*aiAllowedForOrg\(session\.orgId\),\s*loadMonthDrafts\(session\.orgId, selectedId, month\),\s*readAmountsAllowedForOrg\(session\.orgId\),\s*loadLockedMonths\(session\.orgId, selectedId\),\s*\]\);/,
    );
  });

  it("reads the drafts once for the header's scope and hands each section its own (AC5, no N+1)", () => {
    expect(count(page, "loadMonthDrafts(")).toBe(1);
    expect(page).toContain("loadMonthDrafts(session.orgId, selectedId, month)");
    expect(page).toContain("const draftTotals = waitingDraftTotals(drafts);");
    expect(page).toContain("waitingDrafts={draftTotals.get(source.id) ?? null}");
    // Each section is told whether its own source's month is locked.
    expect(page).toContain("monthLocked={lockedMonths.has(`${source.id}:${month}`)}");
  });
});

describe("dashboard source section (app/r/source-budget-section.tsx)", () => {
  const section = code("app/r/source-budget-section.tsx");

  it("shows the drafts notice only with at least one draft, the locked wording on a locked month (AC5, E9)", () => {
    expect(section).toMatch(
      /\{waitingDrafts && waitingDrafts\.count > 0 && \(\s*<DraftsWaitingCard\s+count=\{waitingDrafts\.count\}\s+amount=\{formatMoney\(waitingDrafts\.totalCents\)\}\s+lockedMonth=\{monthLocked \? monthLabel\(month\) : null\}/,
    );
  });

  it("links with the section's source only when the header is on All (E12)", () => {
    expect(section).toContain("href={draftsReviewHref(selectedId === null ? source.id : null)}");
  });

  it("the card itself: title, the locked line only when locked, and the review link", () => {
    const card = code("src/components/expense-imports/drafts-waiting-card.tsx");
    expect(card).toContain("{UI.draftsWaitingTitle(count, amount)}");
    expect(card).toContain("{lockedMonth ? UI.draftsWaitingLockedBody(count, lockedMonth) : UI.draftsWaitingBody(count)}");
    expect(card).toContain("{UI.draftsReviewLink}");
  });
});

describe("recent expenses (app/r/recent-expenses.tsx) wrap instead of truncating (AC3)", () => {
  const recent = code("app/r/recent-expenses.tsx");

  it("has no truncate left, the two row lines wrap, and the card still caps its width", () => {
    expect(recent).not.toMatch(/\btruncate\b/);
    expect(recent).toContain('className="block font-bold text-[15px] text-ink break-words"');
    expect(recent).toContain('className="block text-[13px] text-sub break-words"');
    expect(recent).toMatch(/<Card className="[^"]*\bmin-w-0\b[^"]*"/);
    expect(recent).toMatch(/<span className="min-w-0 flex-1">/);
  });
});

describe("Month-End Packet page (app/r/packet/page.tsx)", () => {
  const page = code("app/r/packet/page.tsx");

  it("shows the next steps only when not blocked, with expenses, not locked and no drafts waiting (AC11, E29 to E32)", () => {
    expect(page).toContain("const draftsWaiting = draftTotal !== null && draftTotal.count > 0;");
    expect(page).toMatch(
      /\{!blocked && readiness\.totalRecords > 0 && !locked && !draftsWaiting && \(\s*<InfoNote className="mb-7">\s*\{readiness\.submittedAt \? UI\.packetSubmittedNextStep : UI\.packetReadyNextSteps\}\s*<\/InfoNote>\s*\)\}/,
    );
    expect(count(page, "UI.packetReadyNextSteps")).toBe(1);
    // Once marked as submitted, only the last step is left (review: it said Mark as submitted again).
    expect(count(page, "UI.packetSubmittedNextStep")).toBe(1);
  });

  it("shows this source and month's drafts notice only with at least one (AC12, E9, E13)", () => {
    expect(page).toContain("loadMonthDrafts(session.orgId, fundingSourceId, month)");
    expect(page).toContain("const draftTotal = waitingDraftTotals(drafts).get(fundingSourceId) ?? null;");
    expect(page).toMatch(
      /\{draftTotal && draftsWaiting && \(\s*<DraftsWaitingCard\s+count=\{draftTotal\.count\}\s+amount=\{formatMoney\(draftTotal\.totalCents\)\}\s+lockedMonth=\{locked \? label : null\}\s+href=\{draftsReviewHref\(null\)\}/,
    );
  });

  it("hands the blocking records' R4.4 labels to the mark dialog (AC8)", () => {
    expect(page).toContain("missingDocuments={readiness.blocking.map((row) => row.label)}");
  });

  it("counts pages with UI.pageCount everywhere, never a hard-coded 'pages' (AC9, E28)", () => {
    expect(page).toContain("{UI.pageCount(readiness.totalPages)}");
    expect(page).toContain("{UI.pageCount(pages)}");
    // The old Total row: `{readiness.totalPages} pages</span>`.
    expect(page).not.toMatch(/\} pages\s*<\//);
    expect(page).not.toContain('=== 1 ? "page"');
  });
});

describe("Mark as submitted asks first (AC8; submitted-marker.tsx, month-lock.tsx)", () => {
  const marker = code("app/r/packet/submitted-marker.tsx");
  const lock = code("app/r/packet/month-lock.tsx");

  it("the button only opens the dialog; the action runs from the dialog's confirm (E26)", () => {
    const button = between(marker, "<Button", "</Button>");
    expect(button).toContain("onClick={() => setConfirming(true)}");
    expect(button).not.toContain("markMonthSubmittedAction");
    expect(button).toContain("{UI.markSubmittedButton}");

    const confirm = between(marker, "confirm={{", "}}\n");
    expect(confirm).toContain("onConfirm: () => {");
    expect(confirm).toMatch(/setConfirming\(false\);\s*run\(\(\) => markMonthSubmittedAction\(month, fundingSourceId\), "Month marked as submitted\."\);/);
    // Exactly one call site: the confirm (the import line has no parenthesis).
    expect(count(marker, "markMonthSubmittedAction(")).toBe(1);
  });

  it("is a neutral dialog titled with the month, Cancel closing it", () => {
    const dialog = between(marker, "<Dialog", "</Dialog>");
    expect(dialog).toContain("open={confirming}");
    expect(dialog).toContain('tone="neutral"');
    expect(dialog).toContain("title={UI.markSubmittedTitle(monthLabel)}");
    expect(dialog).toContain('dismissLabel="Cancel"');
    expect(dialog).toContain("onDismiss={() => setConfirming(false)}");
    expect(dialog).toContain("disabled: pending");
  });

  it("lists every missing record, scrolling inside the dialog, only when some are missing (E23 to E26)", () => {
    const dialog = between(marker, "<Dialog", "</Dialog>");
    const missing = between(dialog, "{missingDocuments.length > 0 && (", "<p>{UI.markSubmittedBody}</p>");
    expect(missing).toContain("{UI.markSubmittedMissing(missingDocuments.length)}");
    expect(missing).toMatch(/<ul className="[^"]*\bmax-h-48\b[^"]*\boverflow-y-auto\b[^"]*">/);
    expect(missing).toMatch(/\{missingDocuments\.map\(\(label, index\) => \(\s*<li key=\{index\}>\{label\}<\/li>/);
    expect(missing).toContain("{UI.markSubmittedAnyway}");
    // The condition closes before the body: every dialog says what marking does.
    expect(missing.trimEnd()).toMatch(/<\/>\s*\)\}$/);
    expect(count(dialog, "{UI.markSubmittedBody}")).toBe(1);
  });

  it("keeps Undo as a ConfirmButton, titled like the mark dialog with the month (#36)", () => {
    expect(marker).toContain("clearMonthSubmittedAction(month, fundingSourceId)");
    const undo = between(marker, "<ConfirmButton", "</ConfirmButton>");
    expect(undo).toContain("title={UI.undoSubmittedTitle(monthLabel)}");
    expect(undo).toContain("body={UI.undoSubmittedBody}");
  });

  it("month-lock passes the month's name and the missing list through", () => {
    const marker = between(lock, "<SubmittedMarker", "/>");
    expect(marker).toContain("monthLabel={monthLabel}");
    expect(marker).toContain("missingDocuments={missingDocuments}");
  });
});

describe("month documents (app/r/packet/month-documents.tsx)", () => {
  const documents = code("app/r/packet/month-documents.tsx");

  it("the missing bank statement reminder is grey, not red (AC10)", () => {
    const reminder = between(documents, "{!hasBankStatement && (", "</p>");
    expect(reminder).toContain("text-sub");
    expect(reminder).not.toContain("text-danger");
    expect(reminder).toContain("No bank statement attached for {monthLabel} yet.");
  });

  it("uses UI.pageCount for each document's pages (AC9)", () => {
    expect(documents).toContain("UI.pageCount(document.pageCount)");
    expect(documents).not.toContain('=== 1 ? "page"');
  });
});

describe("monthly summary drafts note (AC13; summary-section.tsx, summary-editor.tsx)", () => {
  const section = code("src/components/monthly-summary/summary-section.tsx");
  const editor = code("src/components/monthly-summary/summary-editor.tsx");

  it("the section reads this source and month's drafts and passes their count", () => {
    expect(section).toContain("loadMonthDrafts(orgId, fundingSourceId, month)");
    expect(section).toContain("waitingDrafts={drafts.length}");
  });

  it("the note renders nothing at zero and links to the drafts view (E9)", () => {
    const note = between(editor, "function DraftsWaitingNote", "export function SummaryEditor");
    expect(note).toContain("if (count <= 0) return null;");
    expect(note).toContain("{UI.summaryDraftsWaiting(count)}");
    expect(note).toContain("href={draftsReviewHref(null)}");
  });

  it("shows in the 'no summary yet' branch and in the summary body", () => {
    expect(count(editor, "<DraftsWaitingNote count={waitingDrafts} />")).toBe(2);
    const noSummary = between(editor, "{UI.summaryIntro(monthLabel)}", "{canWrite && (");
    expect(noSummary).toContain("<DraftsWaitingNote count={waitingDrafts} />");
    const body = editor.slice(editor.indexOf("function SummaryBody"));
    expect(body).toContain("<DraftsWaitingNote count={waitingDrafts} />");
    // And SummaryEditor passes it to the body.
    expect(editor).toMatch(/<SummaryBody[\s\S]*?waitingDrafts=\{waitingDrafts\}/);
  });
});

describe("Cover Sheets (app/r/cover-sheets)", () => {
  const page = code("app/r/cover-sheets/page.tsx");
  const select = code("app/r/cover-sheets/line-item-select.tsx");
  const preview = code("app/r/cover-sheets/cover-sheet-preview.tsx");

  it("honours a valid ?lineItem=, else opens on the default line item, else All (AC14, E33 to E36)", () => {
    expect(page).toMatch(
      /requested === ALL_LINE_ITEMS\s*\?\s*ALL_LINE_ITEMS\s*:\s*\(lineItems\.find\(\(item\) => item\.id === requested\)\?\.id \?\?\s*defaultCoverSheetLineItemId\(\s*lineItems\.map\(\(item\) => item\.id\),\s*expenses\.map\(\(expense\) => expense\.lineItemId\),?\s*\) \?\?\s*ALL_LINE_ITEMS\)/,
    );
  });

  it("selector options show the plain line item name, no count (user review 2026-09-29)", () => {
    expect(select).toMatch(/<option key=\{item\.id\} value=\{item\.id\}>\s*\{item\.name\}\s*<\/option>/);
    expect(select).not.toContain("item.count");
  });

  it("an empty sheet explains itself with Add Expense only for one line item, not in All (AC15, E34, E35, E37)", () => {
    expect(page).toContain("compact={selected === ALL_LINE_ITEMS}");
    const empty = between(page, "{compact ? (", "</section>");
    const [compactBranch, fullBranch] = empty.split(") : (");
    expect(compactBranch).toContain("No expenses recorded for {monthLabelText} in {lineItem.name} yet.");
    expect(compactBranch).not.toContain("coverSheetWhatItIs");
    expect(compactBranch).not.toContain("/r/expenses/new");
    expect(fullBranch).toContain("No expenses recorded for {monthLabelText} in {lineItem.name} yet.");
    expect(fullBranch).toContain("{UI.coverSheetWhatItIs}");
    expect(fullBranch).toMatch(/<Link href="\/r\/expenses\/new" className=\{buttonClassName\("primary"\)\}>\s*Add Expense\s*<\/Link>/);
  });

  it("lists attached receipts, then attached supporting files, after each expense (AC16, E38, E39)", () => {
    const following = between(page, "followingDocuments: [", "],");
    const receipts = following.indexOf('document.kind === "receipt" && document.status === "attached"');
    const supporting = following.indexOf('document.kind === "supporting" && document.status === "attached"');
    expect(receipts).toBeGreaterThan(-1);
    expect(supporting).toBeGreaterThan(receipts);
    expect(count(following, ".map((document) => document.filename)")).toBe(2);
    // Proofs are on the sheet itself, not after it.
    expect(following).not.toContain('"proof"');
  });

  it("the preview prints the line only when there is something to list", () => {
    expect(preview).toMatch(
      /\{row\.followingDocuments\.length > 0 && \(\s*<p[^>]*>\s*\{UI\.coverSheetFollowingDocs\(row\.followingDocuments\)\}/,
    );
  });
});

describe("amounts panel keeps showing after Use (AC17; expense-form.tsx, amount-suggestion-panel.tsx)", () => {
  const form = code("src/modules/expenses/expense-form.tsx");
  const panel = code("src/modules/expenses/amount-suggestion-panel.tsx");

  it("Use no longer hides the panel; Dismiss still does", () => {
    const apply = between(form, "function applySuggestedAmounts() {", "function useSuggestedAmounts() {");
    expect(apply).toContain("setValues(");
    expect(apply).toContain("setConfirmingUseFor(null);");
    expect(apply).not.toContain("setDismissedFor");
    expect(form).toContain("onDismiss={() => setDismissedFor(amountReadSignature)}");
  });

  it("the form tells the panel whether the fields already hold the suggestion", () => {
    expect(form).toContain("applied={amountsMatchSuggestion(values, suggestion)}");
  });

  it("the panel shows Amounts used in place of Use while applied, Dismiss in both cases (E40 to E45)", () => {
    expect(panel).toMatch(
      /\{applied \? \(\s*<SavedTick>\{UI\.amountsUsed\}<\/SavedTick>\s*\) : \(\s*<Button onClick=\{onUse\}>\{UI\.useTheseAmounts\}<\/Button>\s*\)\}\s*<Button variant="quiet" onClick=\{onDismiss\}>/,
    );
  });
});

describe("invoice screen (app/r/expenses/new/from-invoice/invoice-upload-screen.tsx)", () => {
  const screen = code("app/r/expenses/new/from-invoice/invoice-upload-screen.tsx");

  it("describes the button as a tooltip and to screen readers, not a line that wraps into the header (AC18, E47)", () => {
    expect(screen).toContain("title={UI.invoiceExtractHint}");
    expect(screen).toContain('aria-describedby="invoice-extract-hint"');
    expect(screen).toMatch(/<span id="invoice-extract-hint" className="sr-only">\s*\{UI\.invoiceExtractHint\}\s*<\/span>/);
    // The locked-month line is the only visible text left beside the button.
    expect(screen).toMatch(/\{monthLockedForSelected && \(\s*<Subtext[^>]*>\s*\{UI\.monthLocked\(monthLabel\(activeMonth\)\)\}/);
  });

  it("titles the check screen from the cards on screen, tolerating a kept check with no number (AC19, E49, E50)", () => {
    expect(screen).toContain(
      "{UI.invoiceCheckHeading(check.rows.length, check.vendor, check.invoiceNumber ?? null)}",
    );
    expect(screen).toContain("invoiceNumber: invoice.invoiceNumber ?? null,");
  });

  it("passes the invoice's vendor to the matcher (AC20)", () => {
    const ctx = between(screen, "invoiceDate: invoice.invoiceDate ?? today,", "};");
    expect(ctx).toContain("vendor: invoice.vendor,");
    // And the org's earlier invoice vendors, so a remembered description is not stacked (review).
    expect(ctx).toContain("earlierVendors: matchContext.earlierVendors,");
  });

  it("the whole-bill note is a calm InfoNote, split into tax and fees (AC21, E52)", () => {
    const note = between(screen, "{showWholeBillCharge && (", "</InfoNote>");
    expect(note).not.toContain("DangerPanel");
    expect(note).toContain("<InfoNote");
    expect(note).toContain("tax: check.billTaxCents ? formatMoney(check.billTaxCents) : null,");
    expect(note).toContain("fees: check.billFeesCents ? formatMoney(check.billFeesCents) : null,");
    expect(screen).not.toContain("wholeBillCents");
  });

  it("after Done lands where every saved charge is visible (invoiceDoneHref), and says so beside Done (AC22, E59, PR #27)", () => {
    expect(screen).toContain("const draftCount = cards.length - expenseCount;");
    // The rule itself (drafts view only when every charge is a draft) is tested in draft-rules.test.ts.
    expect(screen).toContain("router.push(invoiceDoneHref(expenseCount, draftCount));");
    expect(screen).toContain("{UI.invoiceDoneHint}");
  });
});

describe("InfoNote (src/components/ui/surfaces.tsx)", () => {
  it("is calm: none of the red that DangerPanel uses", () => {
    const surfaces = code("src/components/ui/surfaces.tsx");
    const note = between(surfaces, "export function InfoNote", "\n}\n");
    expect(note).toContain("bg-section");
    expect(note).not.toMatch(/danger|caution/);
  });
});
