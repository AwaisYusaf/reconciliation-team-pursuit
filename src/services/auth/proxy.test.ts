/**
 * Routing guards in `proxy.ts`.
 *
 * These exist because of a real defect found in the browser, not by unit tests: the proxy
 * used to redirect anyone *holding* a session cookie away from /login. Since it can only
 * see that a cookie exists — never that it is valid — a user whose session had expired or
 * been revoked bounced between /login and / forever and could not sign in again.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "../../../proxy";

function request(path: string, options: { cookie?: string } = {}): NextRequest {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", `session=${options.cookie}`);
  return new NextRequest(new URL(`http://localhost:3000${path}`), { headers });
}

function redirectTarget(response: Response): string | null {
  const location = response.headers.get("location");
  return location ? new URL(location).pathname : null;
}

describe("unauthenticated routing", () => {
  it("sends a visitor with no cookie to the login page", () => {
    expect(redirectTarget(proxy(request("/")))).toBeNull();
    expect(redirectTarget(proxy(request("/r/expenses")))).toBe("/login");
    expect(redirectTarget(proxy(request("/r/packet")))).toBe("/login");
  });

  it("lets the auth routes through so a visitor can actually sign in", () => {
    expect(redirectTarget(proxy(request("/login")))).toBeNull();
    expect(redirectTarget(proxy(request("/signup")))).toBeNull();
    expect(redirectTarget(proxy(request("/onboarding/line-items")))).toBeNull();
  });

  it("lets anyone read the Privacy Policy and Terms of Service without signing in", () => {
    expect(redirectTarget(proxy(request("/privacy")))).toBeNull();
    expect(redirectTarget(proxy(request("/terms")))).toBeNull();
    // Exact paths only: nothing under or beside them is opened by this.
    expect(redirectTarget(proxy(request("/privacy/anything")))).toBe("/login");
    expect(redirectTarget(proxy(request("/terms-old")))).toBe("/login");
  });
});

describe("shared links (PHASE-12)", () => {
  it("lets a visitor with no account open a shared link, its file and its password post", () => {
    expect(redirectTarget(proxy(request("/s/k7Qm2xPa9Xy1")))).toBeNull();
    expect(redirectTarget(proxy(request("/s/k7Qm2xPa9Xy1/Team_Pursuit_March_2026_Packet.pdf")))).toBeNull();
    expect(redirectTarget(proxy(request("/s/k7Qm2xPa9Xy1/unlock")))).toBeNull();
  });

  it("does not open anything that merely starts with /s", () => {
    expect(redirectTarget(proxy(request("/sx")))).toBe("/login");
    expect(redirectTarget(proxy(request("/s")))).toBe("/login");
    expect(redirectTarget(proxy(request("/shared")))).toBe("/login");
  });
});

describe("a cookie that is present but not valid", () => {
  // The regression: presence is not validity. Redirecting on presence alone traps the user.
  it("still lets them reach the login page", () => {
    expect(redirectTarget(proxy(request("/login", { cookie: "expired-or-revoked" })))).toBeNull();
    expect(redirectTarget(proxy(request("/signup", { cookie: "expired-or-revoked" })))).toBeNull();
  });

  it("lets them through to the app, where the real session check redirects them once", () => {
    // No redirect here; app/r/layout.tsx calls getSession() and sends them to /login,
    // which the rule above then renders instead of bouncing back.
    expect(redirectTarget(proxy(request("/r", { cookie: "expired-or-revoked" })))).toBeNull();
  });
});

describe("matcher scope", () => {
  // The API and static assets never reach `proxy` at all — Next filters them out by the
  // matcher, and the API routes authenticate themselves. Next anchors matcher patterns,
  // so the anchors are added here; without them the negative lookahead would match
  // anywhere in the path and every assertion below would pass for the wrong reason.
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it("excludes the API and Next internals", () => {
    expect(matcher.test("/api/files/upload")).toBe(false);
    expect(matcher.test("/_next/static/chunk.js")).toBe(false);
    expect(matcher.test("/favicon.ico")).toBe(false);
    expect(matcher.test("/logo.png")).toBe(false);
  });

  it("covers the application routes", () => {
    expect(matcher.test("/")).toBe(true);
    expect(matcher.test("/r/expenses")).toBe(true);
    expect(matcher.test("/login")).toBe(true);
  });

  it("covers shared links, including the file URL ending in .pdf or .xlsx", () => {
    expect(matcher.test("/s/k7Qm2xPa9Xy1")).toBe(true);
    expect(matcher.test("/s/k7Qm2xPa9Xy1/Team_Pursuit_March_2026_Packet.pdf")).toBe(true);
    expect(matcher.test("/s/k7Qm2xPa9Xy1/Team_Pursuit_March_2026_Summary.xlsx")).toBe(true);
  });
});
