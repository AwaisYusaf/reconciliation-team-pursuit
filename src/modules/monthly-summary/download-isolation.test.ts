/**
 * P13/I-32: the monthly summary download must not touch the packet's cache key or ordering.
 *
 * Source-reading, in the repo's style for wiring checks (`screen.test.ts`,
 * `src/modules/tours/packet-tour.test.ts`) rather than a runtime import assertion — the download
 * route builds fresh from `content_markdown` on every request and is never cached, so it must
 * never import `cache-key.ts` (the packet/cover-sheet artifact hash) or anything from
 * `packet-order.ts`/`packet-pdf.ts` (the packet's own assembly). If either ever crept in, a
 * change to the packet's cache key or section order could silently start affecting (or being
 * affected by) the summary download, which the isolation this file checks rules out.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function read(relPath: string): string {
  return readFileSync(`${repoRoot}${relPath}`, "utf8");
}

describe("monthly summary download route and builder import nothing from the packet cache/ordering modules", () => {
  it.each([
    "app/api/downloads/monthly-summary/route.ts",
    "src/generation/monthly-summary-docx.ts",
  ])("%s", (relPath) => {
    const source = read(relPath);
    expect(source).not.toMatch(/from\s+"@\/src\/generation\/cache-key"/);
    expect(source).not.toMatch(/from\s+"@\/src\/generation\/packet-/);
  });
});
