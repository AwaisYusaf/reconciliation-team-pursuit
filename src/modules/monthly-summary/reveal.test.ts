/**
 * Unit tests for `revealDelays` (Phase 11 follow-up, user feedback 2026-09-18: a bullet list
 * used to reveal as one line instead of one delay per item).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Block } from "@/src/domain/summary-markdown";
import { parseSummaryMarkdown } from "@/src/domain/summary-markdown";

import { revealDelays } from "./reveal";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function inline(text: string) {
  return [{ text, bold: false, italic: false }];
}

describe("revealDelays — line counting", () => {
  it("a heading, a paragraph and a 3-item list count as 1 + 1 + 3 = 5 lines, one delay per line, 150ms apart", () => {
    const blocks = parseSummaryMarkdown("## Heading\nA paragraph.\n- item1\n- item2\n- item3");
    expect(blocks).toEqual([
      { type: "heading", level: 2, inlines: inline("Heading") },
      { type: "paragraph", inlines: inline("A paragraph.") },
      { type: "list", items: [inline("item1"), inline("item2"), inline("item3")] },
    ]);

    const delays = revealDelays(blocks, true);
    expect(delays).toHaveLength(5);
    expect(delays.map((d) => d!.animationDelay)).toEqual(["0ms", "150ms", "300ms", "450ms", "600ms"]);
  });

  it("a list contributes one line PER ITEM, not one per block — two lists of different sizes differ in line count", () => {
    const small: Block[] = [{ type: "list", items: [inline("a")] }];
    const big: Block[] = [{ type: "list", items: [inline("a"), inline("b"), inline("c"), inline("d")] }];
    expect(revealDelays(small, true)).toHaveLength(1);
    expect(revealDelays(big, true)).toHaveLength(4);
  });
});

describe("revealDelays — 4,000ms cap", () => {
  it("a long summary's later lines are capped at 4000ms, not left to grow past it", () => {
    // 40 items: uncapped delay for the last one would be 39 * 150 = 5850ms.
    const items = Array.from({ length: 40 }, (_unused, i) => inline(`item ${i}`));
    const blocks: Block[] = [{ type: "list", items }];
    const delays = revealDelays(blocks, true);
    expect(delays).toHaveLength(40);
    // Below the cap, delays still grow linearly.
    expect(delays[10]!.animationDelay).toBe("1500ms");
    // Once line * 150 would exceed 4000, it clamps instead of continuing to grow.
    expect(delays[27]!.animationDelay).toBe("4000ms"); // 27 * 150 = 4050 -> capped
    expect(delays[39]!.animationDelay).toBe("4000ms"); // far past the cap, still 4000
  });
});

describe("revealDelays — reveal: false", () => {
  it("returns no delays at all, regardless of how many lines the blocks have", () => {
    const items = Array.from({ length: 10 }, (_unused, i) => inline(`item ${i}`));
    const blocks: Block[] = [
      { type: "heading", level: 1, inlines: inline("H") },
      { type: "paragraph", inlines: inline("P") },
      { type: "list", items },
    ];
    expect(revealDelays(blocks, false)).toEqual([]);
    expect(revealDelays([], false)).toEqual([]);
  });
});

describe("the editor's reveal-clearing timeout outlasts the reveal cap", () => {
  it("summary-editor.tsx's setTimeout(4000 + 380 + 120) both matches the actual cap revealDelays uses and exceeds it", () => {
    // Compute the real cap revealDelays uses by forcing a delay far past it.
    const items = Array.from({ length: 60 }, () => inline("x"));
    const blocks: Block[] = [{ type: "list", items }];
    const delays = revealDelays(blocks, true);
    const cap = Math.max(...delays.map((d) => Number(d!.animationDelay!.replace("ms", ""))));

    const source = readFileSync(`${repoRoot}app/r/monthly-summary/summary-editor.tsx`, "utf8");
    const match = source.match(/setTimeout\(\(\) => setReveal\(false\), (\d+) \+ (\d+) \+ (\d+)\)/);
    expect(match, "the reveal-clearing setTimeout must exist in summary-editor.tsx").not.toBeNull();
    const [, capLiteral, wipeMs, bufferMs] = match!;

    // The literal the editor hardcodes as the cap must actually be the same cap revealDelays uses.
    expect(Number(capLiteral)).toBe(cap);
    // And the full timeout must outlast that cap (plus the wipe animation and its buffer) — if
    // someone lowers the timeout below the cap, lines still waiting their turn go invisible.
    const total = Number(capLiteral) + Number(wipeMs) + Number(bufferMs);
    expect(total).toBeGreaterThan(cap);
  });
});
