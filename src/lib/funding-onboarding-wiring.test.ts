/**
 * Usability round 1, batch "funding limit and onboarding": the screen-side conditions, read from
 * source.
 *
 * This repo runs no component-rendering tests (`vitest.config.mts`: `environment: "node"`). The
 * rules themselves are proven through the real actions and pages
 * (`src/modules/{line-items,funding-sources}/funding-limit.integration.test.ts`,
 * `src/modules/auth/onboarding.integration.test.ts`); this file pins the conditions each client
 * screen puts around them, in the style of `usability-round-1-wiring.test.ts`. Comments are
 * stripped first, so a sentence that mentions a call can never satisfy a check meant for code.
 */
import { describe, expect, it } from "vitest";

import { between, sourceCode as code } from "./source-code.test-helper";

describe("Contract Summary (app/r/contract-summary/page.tsx)", () => {
  const page = code("app/r/contract-summary/page.tsx");

  it("#38: with no advances the card explains instead of showing the four rows (a negative balance)", () => {
    const card = between(page, 'data-tour="contract-summary-reconciliation"', "</Card>");
    const [noAdvances, withAdvances] = between(card, "summary.reconciliation.advancesCents === 0 ? (", "</>").split(") : (");
    expect(noAdvances).toContain("{UI.noAdvancesYet}");
    expect(noAdvances).not.toContain("ReconciliationRow");
    expect(withAdvances.split("<ReconciliationRow").length - 1).toBe(4);
  });

  it("#37: the line under the table only when a contract value is set and the totals differ", () => {
    const call = String.raw`\{lineItemsAgainstTotal\(summary\.totals\.scheduledCents, summary\.contractTotalCents\)\}`;
    expect(page).toMatch(
      new RegExp(
        String.raw`\{settings\.contractValueCents > 0 && summary\.totals\.scheduledCents !== summary\.contractTotalCents &&\s*\(overTotal \? \(\s*<DangerPanel[^>]*>\s*` +
          call +
          String.raw`\s*</DangerPanel>\s*\) : \(\s*<InfoNote[^>]*>\s*` +
          call +
          String.raw`\s*</InfoNote>\s*\)\)\}`,
      ),
    );
  });

  it("#39: a hint for each funder column word, each beside its column's name", () => {
    for (const word of ["ScheduledValue", "PreviouslyBilled", "BalanceToFinish", "Base"]) {
      expect(page).toContain(`{ term: UI.term${word}, text: UI.hint${word} }`);
    }
    expect(page).toContain("<ColumnHints");
  });

  it("a blocked download is a notice with a link to the Month-End Packet", () => {
    expect(page).toMatch(/\{refusal && \(\s*<DangerPanel[\s\S]*?\{refusal\}[\s\S]*?href="\/r\/packet"[\s\S]*?\{UI\.openMonthEndPacket\}/);
  });
});

describe("Line Items (app/r/line-items)", () => {
  const page = code("app/r/line-items/page.tsx");
  const manager = code("app/r/line-items/line-items-manager.tsx");

  it("the page compares with a total only when a contract value is set (no value, no limit)", () => {
    expect(page).toContain(
      "contractTotalCents={position && position.contractValueCents > 0 ? fundingTotalCents(position) : null}",
    );
  });

  it("#46: a Total row with the rows, and the comparison line whenever there is a total (even with no rows yet)", () => {
    expect(between(manager, "{rows.length > 0 && (", "</tr>")).toContain("{formatMoney(lineItemsTotal)}");
    expect(manager).toMatch(/\{contractTotalCents !== null &&\s*\(lineItemsTotal > contractTotalCents \?/);
    expect(manager).toContain("{lineItemsAgainstTotal(lineItemsTotal, contractTotalCents)}");
  });

  it("#47: hints for Scheduled value and Performances, each beside its column's name", () => {
    expect(manager).toContain("{ term: UI.termScheduledValue, text: UI.hintScheduledValue }");
    expect(manager).toContain("{ term: UI.termPerformances, text: UI.hintPerformances }");
  });

  it("the over-the-total comparison is a danger notice, an under-total one a calm note", () => {
    expect(manager).toMatch(
      /lineItemsTotal > contractTotalCents \? \(\s*<DangerPanel[^>]*>\{lineItemsAgainstTotal\(lineItemsTotal, contractTotalCents\)\}<\/DangerPanel>\s*\) : \(\s*<InfoNote/,
    );
  });

  it("an Add refusal shows once, in the Add card: its run sends the error to the card's own state", () => {
    const addCard = between(manager, '<Label htmlFor="new-name">', "</Card>");
    expect(between(addCard, "saveLineItemAction({ fundingSourceId, ...addDraft })", "Add line item")).toContain(
      "setAddError,",
    );
    expect(addCard).toContain("{addError && (");
    expect(addCard).not.toContain("{error && (");
  });
});

describe("Settings funding card (app/r/settings/settings-sections.tsx) #19", () => {
  const sections = code("app/r/settings/settings-sections.tsx");

  it("adds '+ Performances = Total' only when a contract value is set and there are new performances", () => {
    const tile = between(sections, 'label="Contract value"', 'tone="accent"');
    expect(tile).toContain("cv > 0 && source.newPerformanceCents > 0");
    expect(tile).toContain("`+ Performances ${formatMoney(source.newPerformanceCents)} = Total ${formatMoney(source.contractTotalCents)}`");
  });
});

describe("Onboarding (app/(auth)/onboarding)", () => {
  const fundingPage = code("app/(auth)/onboarding/funding/page.tsx");
  const fundingForm = code("app/(auth)/onboarding/funding/funding-form.tsx");
  const itemsPage = code("app/(auth)/onboarding/line-items/page.tsx");
  const itemsForm = code("app/(auth)/onboarding/line-items/line-items-form.tsx");

  it("#7: neither step can be skipped", () => {
    for (const source of [fundingPage, fundingForm, itemsPage, itemsForm]) expect(source).not.toMatch(/skip/i);
  });

  it("#11: controls are disabled only while saving (never for a reason left unsaid), and then say so", () => {
    expect(fundingForm).toContain('<Button type="submit" fullWidth disabled={pending}>');
    expect(fundingForm).toContain('{pending ? "Saving…" : "Continue"}');
    expect(itemsForm).toContain('{pending ? "Saving…" : "Finish setup"}');
    // Finish, Back, and the rows themselves (name, amount, Remove, Add line item): the rows can't
    // change under a save, so its answer is about the rows still on screen.
    expect(itemsForm.match(/disabled=\{[^}]*\}/g)).toEqual(Array(6).fill("disabled={pending}"));
  });

  it("#5: the live Planned line reads the rows with the server's own parser, never a negative 'left'", () => {
    expect(itemsForm).toContain("sumBy(rows, (row) => parseMoneyToCentsOrZero(row.budget))");
    expect(itemsForm).toContain("const over = plannedCents > totalCents;");
    expect(itemsForm).toContain("formatMoney(Math.abs(totalCents - plannedCents))");
  });

  it("#8: each row error stays with its row: read by the server's position key, cleared or moved with that row only", () => {
    expect(itemsForm).toContain("Array.from({ length: submitted }, (_, i) => result.fieldErrors?.[`row-${i}`])");
    expect(between(itemsForm, "function update(", "function remove(")).toContain(
      "rowErrors.map((message, i) => (i === index ? undefined : message))",
    );
    expect(between(itemsForm, "function remove(", "const plannedCents")).toContain(
      "rowErrors.filter((_, i) => i !== index)",
    );
  });

  it("after a refused Finish, focus goes to the first marked row once the rows are enabled again", () => {
    expect(between(itemsForm, "if (result.ok) return;", "setError(result.error);")).toContain(
      "focusFirstError.current = true;",
    );
    expect(itemsForm).toContain("if (pending || !focusFirstError.current) return;");
    expect(itemsForm).toContain("document.getElementById(`row-${first}-name`)?.focus()");
    expect(itemsForm).toContain("id={`row-${index}-name`}");
  });

  it("the tab's draft is this organization's own", () => {
    expect(itemsForm).toContain("const draftKey = `onboarding-line-items:${orgId}`;");
  });
});
