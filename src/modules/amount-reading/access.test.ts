/**
 * Access gate for reading amounts from documents (Phase 10 §3.1). The DB-backed
 * `readAmountsAllowedForOrg` is exercised in the route integration test instead — this file is
 * the pure `canReadAmounts`/`openAiConfigured`/`readAmountsPlanAllowed` combinators, each gate
 * checked alone against the others held constant.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { canReadAmounts, openAiConfigured, readAmountsPlanAllowed } from "./access";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("openAiConfigured", () => {
  it("true when both key and model are set", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-real");
    vi.stubEnv("OPENAI_READ_MODEL", "gpt-5.6-luna");
    expect(openAiConfigured()).toBe(true);
  });

  it("false when the key is missing", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_READ_MODEL", "gpt-5.6-luna");
    expect(openAiConfigured()).toBe(false);
  });

  it("false when the model is missing", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-real");
    vi.stubEnv("OPENAI_READ_MODEL", "");
    expect(openAiConfigured()).toBe(false);
  });

  it("false when the key is whitespace only", () => {
    vi.stubEnv("OPENAI_API_KEY", "   ");
    vi.stubEnv("OPENAI_READ_MODEL", "gpt-5.6-luna");
    expect(openAiConfigured()).toBe(false);
  });

  it("false when the model is whitespace only", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-real");
    vi.stubEnv("OPENAI_READ_MODEL", "   ");
    expect(openAiConfigured()).toBe(false);
  });

  it("false when both are unset", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_READ_MODEL", "");
    expect(openAiConfigured()).toBe(false);
  });
});

describe("readAmountsPlanAllowed", () => {
  it("true only for reconciliation_ai", () => {
    expect(readAmountsPlanAllowed("reconciliation_ai")).toBe(true);
    expect(readAmountsPlanAllowed("reconciliation")).toBe(false);
  });
});

describe("canReadAmounts — every gate alone false → false", () => {
  it("base plan, switch on, configured → false (plan gate)", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-real");
    vi.stubEnv("OPENAI_READ_MODEL", "gpt-5.6-luna");
    expect(canReadAmounts({ plan: "reconciliation", readAmountsEnabled: true })).toBe(false);
  });

  it("AI plan, switch off, configured → false (switch gate)", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-real");
    vi.stubEnv("OPENAI_READ_MODEL", "gpt-5.6-luna");
    expect(canReadAmounts({ plan: "reconciliation_ai", readAmountsEnabled: false })).toBe(false);
  });

  it("AI plan, switch on, not configured → false (server config gate)", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_READ_MODEL", "");
    expect(canReadAmounts({ plan: "reconciliation_ai", readAmountsEnabled: true })).toBe(false);
  });

  it("all three gates satisfied → true", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-real");
    vi.stubEnv("OPENAI_READ_MODEL", "gpt-5.6-luna");
    expect(canReadAmounts({ plan: "reconciliation_ai", readAmountsEnabled: true })).toBe(true);
  });
});
