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
