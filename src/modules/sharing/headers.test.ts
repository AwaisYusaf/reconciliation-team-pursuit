/**
 * P17: every response under `/s/*` stays out of search results and never leaks its token in a
 * Referer — one rule in `next.config.ts`, which the routes rely on rather than repeat — and no
 * Suspense boundary under `app/s` can turn the unavailable page's 404 into a streamed 200.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function filesUnder(relDir: string): string[] {
  return readdirSync(path.join(repoRoot, relDir)).flatMap((entry) => {
    const rel = path.join(relDir, entry);
    return statSync(path.join(repoRoot, rel)).isDirectory() ? filesUnder(rel) : [rel];
  });
}

describe("shared-link headers and status (P17)", () => {
  it("next.config sends noindex and no-referrer for all of /s/*", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const rule = rules.find((entry) => entry.source === "/s/:path*");
    expect(rule?.headers).toEqual(
      expect.arrayContaining([
        { key: "X-Robots-Tag", value: expect.stringMatching(/noindex/) },
        { key: "Referrer-Policy", value: "no-referrer" },
      ]),
    );
  });

  it("the layout says the same in its metadata", () => {
    const layout = readFileSync(path.join(repoRoot, "app/s/layout.tsx"), "utf8");
    expect(layout).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
    expect(layout).toMatch(/referrer:\s*"no-referrer"/);
  });

  it("nothing under app/s streams: no loading.tsx and no Suspense", () => {
    const files = filesUnder("app/s");
    expect(files.some((file) => path.basename(file).startsWith("loading."))).toBe(false);
    for (const file of files) {
      expect(readFileSync(path.join(repoRoot, file), "utf8")).not.toMatch(/<Suspense\b/);
    }
    expect(existsSync(path.join(repoRoot, "app/s/[token]/not-found.tsx"))).toBe(true);
  });
});
