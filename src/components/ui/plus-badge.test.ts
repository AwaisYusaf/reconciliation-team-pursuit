/**
 * U-16: only the header's Plus pill is a link (to Plan & billing); every other pill stays
 * decorative (Phase 15 AC-H2). Source-reading, like the other UI wiring tests.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : tsxFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

describe("PlusBadge links", () => {
  const uses = [...tsxFiles(path.join(repoRoot, "app")), ...tsxFiles(path.join(repoRoot, "src"))].flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(/<PlusBadge\b[^>]*>/g)].map((m) => ({
      file: path.relative(repoRoot, file).split(path.sep).join("/"),
      tag: m[0],
    }));
  });

  it("is used somewhere (the scan is not empty)", () => {
    expect(uses.length).toBeGreaterThan(2);
  });

  it("only the header pill in app/r/layout.tsx has an href, and it opens Plan & billing", () => {
    const linked = uses.filter((u) => /\bhref=/.test(u.tag));
    expect(linked).toEqual([{ file: "app/r/layout.tsx", tag: '<PlusBadge href="/r/settings?section=plan" />' }]);
  });

  it("the linked pill has an accessible name and a 44px target", () => {
    const source = readFileSync(path.join(repoRoot, "src/components/ui/plus-badge.tsx"), "utf8");
    expect(source).toContain("aria-label={UI.plusPillLabel}");
    expect(source).toContain("min-h-11");
  });
});
