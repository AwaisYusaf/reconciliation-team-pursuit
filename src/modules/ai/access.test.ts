/**
 * Access gates for AI features (Phase 10 §3.1; Phase 11 P1). The DB-backed
 * `readAmountsAllowedForOrg`/`summariesAccessForOrg` are exercised in the route integration test
 * instead — this file is the pure `canReadAmounts`/`openAiConfigured`/`aiPlanAllowed`
 * combinators, each gate checked alone against the others held constant.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { aiPlanAllowed, canReadAmounts, canUseSummaries, canWriteSummaries, openAiConfigured } from "./access";

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

describe("aiPlanAllowed", () => {
  it("true only for reconciliation_ai", () => {
    expect(aiPlanAllowed("reconciliation_ai")).toBe(true);
    expect(aiPlanAllowed("reconciliation")).toBe(false);
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

/**
 * U-19 (Phase 11, D-107, P1): the full plan × key × summary-model matrix for `canUseSummaries`/
 * `canWriteSummaries`, plus proof that the receipt-reading switch and `OPENAI_READ_MODEL` never
 * affect summaries, and that adding either back in would be caught (mutation-checked separately).
 */
describe("canUseSummaries — plan only, independent of key/model/switch", () => {
  it("true for the AI plan regardless of server configuration", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_SUMMARY_MODEL", "");
    expect(canUseSummaries({ plan: "reconciliation_ai" })).toBe(true);
  });

  it("false for the base plan even with everything configured", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-real");
    vi.stubEnv("OPENAI_SUMMARY_MODEL", "gpt-5.6-terra");
    expect(canUseSummaries({ plan: "reconciliation" })).toBe(false);
  });
});

describe("canWriteSummaries — plan × key × OPENAI_SUMMARY_MODEL matrix", () => {
  const cases: Array<{
    plan: "reconciliation" | "reconciliation_ai";
    key: string;
    model: string;
    expected: boolean;
  }> = [
    { plan: "reconciliation", key: "", model: "", expected: false },
    { plan: "reconciliation", key: "sk-real", model: "gpt-5.6-terra", expected: false },
    { plan: "reconciliation_ai", key: "", model: "", expected: false },
    { plan: "reconciliation_ai", key: "sk-real", model: "", expected: false },
    { plan: "reconciliation_ai", key: "", model: "gpt-5.6-terra", expected: false },
    { plan: "reconciliation_ai", key: "   ", model: "gpt-5.6-terra", expected: false }, // whitespace-only key
    { plan: "reconciliation_ai", key: "sk-real", model: "   ", expected: false }, // whitespace-only model
    { plan: "reconciliation_ai", key: "sk-real", model: "gpt-5.6-terra", expected: true },
  ];

  it.each(cases)(
    "plan=$plan key=$key model=$model → $expected",
    ({ plan, key, model, expected }) => {
      vi.stubEnv("OPENAI_API_KEY", key);
      vi.stubEnv("OPENAI_SUMMARY_MODEL", model);
      expect(canWriteSummaries({ plan })).toBe(expected);
    },
  );

  it("the receipt-reading switch does not affect writing even if the caller's org object carries it", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-real");
    vi.stubEnv("OPENAI_SUMMARY_MODEL", "gpt-5.6-terra");
    // A real org row carries readAmountsEnabled too; canWriteSummaries must not read it off
    // whatever object it's given — assigned through a variable (not a literal) so an extra
    // property doesn't trip TS's excess-property check, proving the function itself ignores it.
    const orgWithSwitchOff: { plan: "reconciliation_ai"; readAmountsEnabled: boolean } = {
      plan: "reconciliation_ai",
      readAmountsEnabled: false,
    };
    expect(canWriteSummaries(orgWithSwitchOff)).toBe(true);
  });

  it("OPENAI_READ_MODEL is never consulted: set it, leave OPENAI_SUMMARY_MODEL unset → still false", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-real");
    vi.stubEnv("OPENAI_READ_MODEL", "gpt-5.6-luna");
    vi.stubEnv("OPENAI_SUMMARY_MODEL", "");
    expect(canWriteSummaries({ plan: "reconciliation_ai" })).toBe(false);
  });

  it("OPENAI_SUMMARY_MODEL set with OPENAI_READ_MODEL unset still allows writing (fully independent settings)", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-real");
    vi.stubEnv("OPENAI_READ_MODEL", "");
    vi.stubEnv("OPENAI_SUMMARY_MODEL", "gpt-5.6-terra");
    expect(canWriteSummaries({ plan: "reconciliation_ai" })).toBe(true);
  });
});

describe("receipt-reading behaviour is unchanged by the split (same combinators, same results)", () => {
  it("canReadAmounts still requires its own three gates, untouched by summaries' env vars", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-real");
    vi.stubEnv("OPENAI_READ_MODEL", "gpt-5.6-luna");
    vi.stubEnv("OPENAI_SUMMARY_MODEL", ""); // summaries unconfigured must not affect receipt reading
    expect(canReadAmounts({ plan: "reconciliation_ai", readAmountsEnabled: true })).toBe(true);
  });
});
