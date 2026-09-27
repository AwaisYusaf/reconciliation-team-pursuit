/**
 * No price literal lives outside `PRICES_CENTS` (Phase 7, U-19).
 *
 * `src/modules/billing/pricing.ts` is the one place a price is spelled out; the landing page,
 * its JSON-LD, and everything else read it through `planPriceLabel`/`priceCents`. Walked the
 * same way `no-dashes.test.ts` walks the repo, but as a raw text search rather than a parsed
 * one: a price can leak into a JSON-LD string built by hand or a stray doc-comment example just
 * as easily as into JSX, and both have to fail here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PRICES_CENTS } from "@/src/modules/billing/pricing";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** The only file allowed to spell a price out (U-19's one source of truth). */
const ALLOWED = "src/modules/billing/pricing.ts";

function sourceFiles(relDir: string): string[] {
  return readdirSync(path.join(repoRoot, relDir)).flatMap((entry) => {
    const rel = path.posix.join(relDir, entry);
    if (statSync(path.join(repoRoot, rel)).isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [rel] : [];
  });
}

const FILES = [...sourceFiles("app"), ...sourceFiles("src")].filter((file) => file !== ALLOWED);

/** Every dollar amount `PRICES_CENTS` can produce, as plain digit text: with and without the
 *  thousands separator, so both "3564" and "3,564" are caught (derived, never hard-coded). */
function dollarAmounts(): string[] {
  const amounts = new Set<string>();
  for (const plan of Object.values(PRICES_CENTS)) {
    for (const cents of Object.values(plan)) {
      const dollars = cents / 100;
      amounts.add(String(Math.trunc(dollars)));
      amounts.add(dollars.toLocaleString("en-US"));
    }
  }
  return [...amounts];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A `$297`-style mention, or a string literal that is exactly the bare amount or `amount.00`
 *  (any quote kind) — never a false hit on a longer number like `1297` or `29700`. */
function checksFor(digits: string): RegExp[] {
  const escaped = escapeRegExp(digits);
  return [
    new RegExp(`\\$\\s?${escaped}(?![\\d,])`),
    new RegExp(`(['"\`])${escaped}\\1`),
    new RegExp(`(['"\`])${escaped}\\.00\\1`),
  ];
}

describe("no price literal outside PRICES_CENTS (U-19)", () => {
  it("reads the whole app, not an empty list", () => {
    expect(FILES).toContain("app/page.tsx");
    expect(FILES).toContain("src/modules/landing/landing-page.tsx");
    expect(FILES).toContain("src/modules/landing/plan-links.ts");
    expect(FILES).not.toContain(ALLOWED);
    expect(FILES.length).toBeGreaterThan(200);
  });

  it("finds none of PRICES_CENTS's amounts spelled out anywhere else", () => {
    const amounts = dollarAmounts();
    expect(amounts.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(path.join(repoRoot, file), "utf8");
      for (const digits of amounts) {
        for (const re of checksFor(digits)) {
          if (re.test(text)) offenders.push(`${file}  matches ${re}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
