/**
 * What Skip and Finish store (D-132). Same source-reading approach as the other tour wiring
 * tests; this repo runs no jsdom/component-rendering tests.
 *
 * Skip (and Escape, which calls the same `finish(true)`) must mark every tour seen, so skipping on
 * one tab stops the tour on every other tab. Finish marks only its own. The actions themselves
 * are proven against the database in `tours.integration.test.ts`; this pins that the tour card
 * calls the right one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const source = readFileSync(`${repoRoot}src/components/ui/tour.tsx`, "utf8");

/** The body of `finish(skipped)`, up to the next function in the component. */
function finishBody(): string {
  const start = source.indexOf("function finish(skipped: boolean) {");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n  function ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

describe("tour dismissal (D-132)", () => {
  it("Skip marks every tour seen, and never only this one", () => {
    const body = finishBody();
    const skipBlock = body.slice(body.indexOf("if (skipped) {"), body.indexOf("return;") + "return;".length);
    expect(skipBlock).toContain("skipAllToursAction()");
    expect(skipBlock).not.toContain("completeTourAction");
  });

  it("Finish marks only its own tour, after the Skip branch has returned", () => {
    const body = finishBody();
    const afterSkip = body.slice(body.indexOf("return;"));
    expect(afterSkip).toContain("completeTourAction(tour)");
    expect(afterSkip).not.toContain("skipAllToursAction");
  });

  it("Escape and the Skip button both go through finish(true)", () => {
    expect(source).toMatch(/event\.key === "Escape"[\s\S]{0,200}finish\(true\)/);
    expect(source).toMatch(/onClick=\{\(\) => finish\(true\)\}/);
  });
});
