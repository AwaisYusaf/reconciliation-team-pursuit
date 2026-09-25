/**
 * A source-level render check for `LandingPage` (Phase 7, B-18 proxy). `renderToStaticMarkup`
 * runs it against real React with no browser: `next/image` and `next/link` both render to plain
 * `<img>`/`<a>` tags outside a real Next.js request, so this works without a fallback to a
 * source-reading test. Written with `React.createElement` (no JSX) so the file stays `.test.ts`
 * — this repo's vitest config only picks up `src/**\/*.test.ts`, not `.tsx`.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { planPriceLabel } from "@/src/modules/landing/plan-links";
import { PRICES_CENTS } from "@/src/modules/billing/pricing";
import { LandingPage } from "@/src/modules/landing/landing-page";

function render(signupOpen: boolean): string {
  return renderToStaticMarkup(createElement(LandingPage, { prices: PRICES_CENTS, signupOpen }));
}

describe("LandingPage render (signupOpen true)", () => {
  const html = render(true);

  it("links each plan's Get Started card to its signup URL with the default Monthly interval", () => {
    expect(html).toContain('href="/signup?plan=reconciliation&amp;interval=month"');
    expect(html).toContain('href="/signup?plan=reconciliation_ai&amp;interval=month"');
  });

  it("has three Book a demo links (two cards + closing section), all to the mailto address", () => {
    const matches = html.match(/Book a demo/g) ?? [];
    expect(matches).toHaveLength(3);
    const mailtoMatches = html.match(/href="mailto:tech@teampursuit\.org\?subject=Stay%20Funded%20360%20demo%20request"/g) ?? [];
    expect(mailtoMatches).toHaveLength(3);
  });

  it("shows Monthly prices by default, produced via planPriceLabel off PRICES_CENTS, not typed in", () => {
    expect(html).toContain(planPriceLabel(PRICES_CENTS.reconciliation.month));
    expect(html).toContain(planPriceLabel(PRICES_CENTS.reconciliation_ai.month));
    expect(html).toContain("/ month");
  });

  it("has no 'early access' text anywhere", () => {
    expect(html.toLowerCase()).not.toContain("early access");
  });

  it("has a header link to /login (Sign in)", () => {
    expect(html).toContain('href="/login"');
    expect(html).toContain("Sign in");
  });

  it("embeds a FAQ JSON-LD script that parses as JSON", () => {
    const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    const parsedScripts = scripts.map((match) => JSON.parse(match[1]));
    const faq = parsedScripts.find((doc) => doc["@type"] === "FAQPage");
    expect(faq).toBeDefined();
    expect(Array.isArray(faq.mainEntity)).toBe(true);
    expect(faq.mainEntity.length).toBeGreaterThan(0);
  });
});

describe("LandingPage render (signupOpen false)", () => {
  const html = render(false);

  it("sends every Get Started link to the walkthrough anchor instead of /signup", () => {
    expect(html).not.toContain('href="/signup');
    // Both header and hero "Get Started" plus both pricing cards' Get Started links.
    const anchorMatches = html.match(/href="#schedule-walkthrough"/g) ?? [];
    expect(anchorMatches.length).toBeGreaterThanOrEqual(4);
  });

  it("still has no 'early access' text", () => {
    expect(html.toLowerCase()).not.toContain("early access");
  });

  it("still has three Book a demo links to the mailto address", () => {
    const matches = html.match(/Book a demo/g) ?? [];
    expect(matches).toHaveLength(3);
  });
});
