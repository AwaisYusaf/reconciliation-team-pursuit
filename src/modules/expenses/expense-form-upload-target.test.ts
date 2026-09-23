/**
 * Regression: the `saveAction` (draft) and `editing` (real expense) branches in `save()`
 * (expense-form.tsx) used to have their `uploadQueued` owner argument swapped — `editing` passed
 * "draft" (sending a real expense id down the draft ingest path, where it always failed with
 * "That draft no longer exists.") and the `saveAction` branch never uploaded at all (no
 * `uploadQueued` call), so a file queued while editing a draft was silently dropped.
 *
 * This repo runs no jsdom/component-rendering tests (`vitest.config.mts`: `environment: "node"`),
 * so this is a structural read of the source, the same way `drafts-section.test.ts` pins its own
 * component's wiring. A full render/interaction test would need jsdom + user-event wiring this
 * repo doesn't have; noted here rather than added silently.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const source = readFileSync(`${repoRoot}src/modules/expenses/expense-form.tsx`, "utf8");

/** The body of `save()`, from its declaration to the closing of `startTransition(async () => {`. */
function saveFunctionBody(): string {
  const start = source.indexOf("function save() {");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n  /** The draft button beside Save", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("ExpenseForm save(): the draft/expense upload-target fix", () => {
  const body = saveFunctionBody();

  it("the saveAction (draft) branch uploads to the DRAFT table, via uploadQueued(id, \"draft\")", () => {
    const saveActionIdx = body.indexOf("if (saveAction) {");
    expect(saveActionIdx).toBeGreaterThan(-1);
    const editingIdx = body.indexOf("if (editing) {", saveActionIdx);
    expect(editingIdx).toBeGreaterThan(saveActionIdx);

    const saveActionBranch = body.slice(saveActionIdx, editingIdx);
    expect(saveActionBranch).toContain('uploadQueued(existing!.id, "draft")');

    // And it happens before the branch navigates away.
    const uploadIdx = saveActionBranch.indexOf('uploadQueued(existing!.id, "draft")');
    const pushIdx = saveActionBranch.indexOf("router.push(");
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(uploadIdx);
  });

  it('the editing (real expense) branch uploads to expense_documents, via uploadQueued(id) with NO second argument', () => {
    const editingIdx = body.indexOf("if (editing) {");
    expect(editingIdx).toBeGreaterThan(-1);
    const embeddedIdx = body.indexOf("if (embedded) {", editingIdx);
    expect(embeddedIdx).toBeGreaterThan(editingIdx);

    const editingBranch = body.slice(editingIdx, embeddedIdx);
    // Must call uploadQueued(existing!.id) with nothing else on the same call — not
    // uploadQueued(existing!.id, "draft"), which was the swapped-branch bug.
    expect(editingBranch).toContain("uploadQueued(existing!.id)");
    expect(editingBranch).not.toContain('uploadQueued(existing!.id, "draft")');
  });

  it("the two branches use different owners for uploadQueued, so they cannot be re-swapped without this test noticing", () => {
    const saveActionIdx = body.indexOf("if (saveAction) {");
    const editingIdx = body.indexOf("if (editing) {", saveActionIdx);
    const embeddedIdx = body.indexOf("if (embedded) {", editingIdx);

    const saveActionBranch = body.slice(saveActionIdx, editingIdx);
    const editingBranch = body.slice(editingIdx, embeddedIdx);

    // Checked as the literal call, not a bare substring search for the word "draft" — the
    // editing branch's own comment mentions the bug by name, which a naive `.not.toContain`
    // would misfire on.
    expect(saveActionBranch).toContain('uploadQueued(existing!.id, "draft")');
    expect(editingBranch).not.toContain('uploadQueued(existing!.id, "draft")');
  });
});

/**
 * The client half of the supporting-document fix, pinned the way this repo pins client wiring
 * (source text — `vitest.config` runs `environment: "node"`, so there is no render harness).
 *
 * The integration test in `from-invoice.integration.test.ts` proves the SERVER reads the type
 * and refuses to drop the file silently. It cannot prove the client sends it, because it builds
 * the FormData itself — so these two assertions cover the hop the integration test skips.
 */
describe("a charge card carries its supporting document's type", () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

  it("the form mirrors supportingType up to the card, not just scope and file", () => {
    const form = readFileSync(`${repoRoot}src/modules/expenses/expense-form.tsx`, "utf8");
    expect(form).toMatch(/supportingType: item\.supportingType \?\? null/);
  });

  it("the invoice screen posts that type alongside the file", () => {
    const screen = readFileSync(
      `${repoRoot}app/r/expenses/new/from-invoice/invoice-upload-screen.tsx`,
      "utf8",
    );
    expect(screen).toMatch(/rowFileTypes-\$\{index\}-supporting/);
  });

  /**
   * The other half of the same loss. The server now names the files it could not attach, but
   * the screen used to read only `{ ok, error }` off the answer and show a clean success — so
   * a dropped document was still dropped in silence, one hop later. The file is gone from the
   * browser once this screen navigates, which is what makes it unrecoverable.
   */
  it("the invoice screen reports the files the server could not attach", () => {
    const screen = readFileSync(
      `${repoRoot}app/r/expenses/new/from-invoice/invoice-upload-screen.tsx`,
      "utf8",
    );
    expect(screen).toContain("attachmentErrors");
    expect(screen).toMatch(/toast\.error\(UI\.invoiceFilesNotAttached\(/);

    // And it is said BEFORE the success toast, not instead of it: both are true.
    const failure = screen.indexOf("UI.invoiceFilesNotAttached(");
    const success = screen.indexOf("UI.invoiceDoneResult(");
    expect(failure).toBeGreaterThan(-1);
    expect(success).toBeGreaterThan(failure);
  });
});

/**
 * The invoice check screen mounts one ExpenseForm per charge, so any fixed element id appears
 * once per card on the same page. Duplicate ids make `htmlFor` focus the FIRST card's input
 * whichever card's label was clicked, and point every `aria-labelledby` at the first card's
 * label, so a screen reader announces the wrong field name on all but one.
 */
/**
 * "Save and approve" on the draft edit screen was gated on the STORED row, on the server, when
 * the page rendered. A draft is short of something — usually its narrative — which is exactly
 * why someone opens this screen, so the button was hidden from every draft anyone came here to
 * finish, and appeared only after saving, leaving and re-entering.
 *
 * Structural, like the rest of this file: `vitest.config.mts` runs `environment: "node"`, so
 * there is no render harness to click the button in.
 */
describe("the draft edit screen offers Save changes and Save and approve, always both", () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const form = readFileSync(`${repoRoot}src/modules/expenses/expense-form.tsx`, "utf8");
  const page = readFileSync(`${repoRoot}app/r/expenses/drafts/[id]/edit/page.tsx`, "utf8");

  it("the page hands the action over unconditionally", () => {
    expect(page).toContain("approveAction={approveDraftAction}");
    // The server-rendered gate specifically: it hid the button from the drafts someone opens
    // this screen to finish, since a draft still missing its narrative is the normal case.
    expect(page).not.toContain("draftIsReady(draft) ? approveDraftAction");
  });

  it("renders the button whenever the action is there, with no readiness condition on it", () => {
    expect(form).toContain("{approveAction && (");
    expect(form).not.toMatch(/\{approveAction && \w+ && \(/);
  });

  it("explains a refusal in field names, since 'open it' makes no sense with it open", () => {
    // Computed from the live values, not the row the page rendered from.
    expect(form).toMatch(/const stillNeeds = \(\) =>\s*\n?\s*draftNeeds\(\{/);
    expect(form).toContain("lineItemId: values.lineItemId || null");
    expect(form).toContain("UI.draftSavedNotApproved(needs)");
    // Anything the screen cannot know better than the server still comes from the server.
    expect(form).toContain("needs.length > 0 ? UI.draftSavedNotApproved(needs) : approved.error");
  });
});

describe("field ids are unique per mounted form", () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const form = readFileSync(`${repoRoot}src/modules/expenses/expense-form.tsx`, "utf8");
  const withoutComments = form.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("uses no literal id or htmlFor anywhere in the markup", () => {
    expect(withoutComments).not.toMatch(/\sid="[a-zA-Z]/);
    expect(withoutComments).not.toMatch(/htmlFor="[a-zA-Z]/);
  });

  it("builds them from useId, so two cards cannot collide", () => {
    expect(withoutComments).toMatch(/const uid = useId\(\)/);
    expect(withoutComments).toMatch(/htmlFor=\{fieldId\("narrative"\)\}/);
    expect(withoutComments).toMatch(/aria-labelledby=\{fieldId\("lineItem-label"\)\}/);
  });
});
