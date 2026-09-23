/**
 * Phase 14 §2: `read-amounts/route.ts` and `read-invoice/route.ts` must both enforce the page cap
 * through this one shared constant, never a locally redefined number — otherwise the two limits
 * can silently drift apart (exactly the failure mode the doc comment on `page-cap.ts` calls out).
 *
 * Source-reading, in the repo's style for wiring checks (`sharing/public-isolation.test.ts`):
 * grep each route's own source rather than asserting on behaviour, so a drift is caught even if
 * a future change makes the two routes behave identically by coincidence.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MAX_PAGES_READ } from "./page-cap";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const ROUTES = [
  path.join("app", "api", "files", "read-amounts", "route.ts"),
  path.join("app", "api", "files", "read-invoice", "route.ts"),
];

describe("the page cap cannot drift between the two read routes", () => {
  it("MAX_PAGES_READ is 10", () => {
    // Pins the actual number, not just "both routes agree" — a coordinated change to both routes
    // would otherwise pass every other assertion here while still changing the limit unnoticed.
    expect(MAX_PAGES_READ).toBe(10);
  });

  it.each(ROUTES)("%s imports MAX_PAGES_READ from the shared module", (route) => {
    const source = readFileSync(path.join(repoRoot, route), "utf8");
    expect(source).toMatch(/import\s*\{[^}]*\bMAX_PAGES_READ\b[^}]*\}\s*from\s*["']@\/src\/modules\/amount-reading\/page-cap["']/);
  });

  it.each(ROUTES)("%s does not redefine its own page limit constant", (route) => {
    const source = readFileSync(path.join(repoRoot, route), "utf8");
    // A route re-declaring `const MAX_PAGES_READ = ...` or any other local page-limit constant
    // would shadow the import and defeat the point of sharing it.
    expect(source).not.toMatch(/const\s+MAX_PAGES_READ\s*=/);
  });
});
