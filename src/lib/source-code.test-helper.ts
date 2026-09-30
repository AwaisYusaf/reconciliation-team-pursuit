/**
 * A file's code, for the repo's source-text wiring tests. The suite runs in Node with no render
 * harness (`vitest.config.mts`), so a screen's wiring is pinned by reading its source.
 *
 * Comments are removed first (JSX, block, then line comments not inside a URL or a string), so
 * a sentence that mentions a call can never satisfy a check meant for the code. Line endings are
 * normalised, so a check reads the same on Windows and Linux. Not for files with `/*` or `//`
 * inside a string: those would be cut as comments.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export function sourceCode(repoPath: string): string {
  return readFileSync(`${repoRoot}${repoPath}`, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** The text from `start` up to (not including) `end`, both required to be present in order. */
export function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `missing: ${start}`).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing after ${start}: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}
