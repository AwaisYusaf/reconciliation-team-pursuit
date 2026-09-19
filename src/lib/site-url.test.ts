import { afterEach, describe, expect, it, vi } from "vitest";

import { appUrlProblem, siteOrigin } from "./site-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("appUrlProblem", () => {
  it("accepts an http(s) address", () => {
    expect(appUrlProblem("https://stayfunded360.com")).toBeNull();
    expect(appUrlProblem("http://localhost:3001/")).toBeNull();
  });

  it("names what is wrong otherwise", () => {
    expect(appUrlProblem(undefined)).toBe("it is not set");
    expect(appUrlProblem("")).toBe("it is not set");
    expect(appUrlProblem("stayfunded360.com")).toMatch(/is not a URL/);
    expect(appUrlProblem("ftp://stayfunded360.com")).toMatch(/is not an http\(s\) address/);
  });
});

describe("siteOrigin", () => {
  it("is the origin alone, whatever path or slash APP_URL carries", () => {
    vi.stubEnv("APP_URL", "https://stayfunded360.com/some/path/");
    expect(siteOrigin()).toBe("https://stayfunded360.com");
  });

  it("falls back to the dev server outside production", () => {
    vi.stubEnv("APP_URL", "");
    expect(siteOrigin()).toBe("http://localhost:3000");
  });

  it("refuses to guess in production", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => siteOrigin()).toThrow(/APP_URL must be set in production/);
  });
});
