/**
 * Unit tests for `writeSummary` / `parseWriteSummaryResponse` / `retryFeedbackFor` (Phase 11 §5).
 * Mocked `fetch` only — no real network call. Response-parser cases beyond what
 * `read-amounts.test.ts` already proves generically (via the shared `./responses.ts` helpers)
 * are re-asserted here against `parseWriteSummaryResponse` itself, since it is this file's own
 * export and has its own markdown-specific guard (empty/whitespace markdown).
 */
import { describe, expect, it, vi } from "vitest";

import { buildMonthFacts, type MonthFacts } from "@/src/domain/monthly-summary-facts";
import { SUMMARY_SECTION_TITLES } from "@/src/domain/strings";

import { costMicroUsd } from "./responses";
import {
  parseWriteSummaryResponse,
  retryFeedbackFor,
  SUMMARY_MAX_OUTPUT_TOKENS,
  SUMMARY_PROMPT,
  SUMMARY_REQUEST_MAX_CHARS,
  writeSummary,
} from "./write-summary";

function responsesBody(outputText: unknown, opts: { status?: string; itemStatus?: string } = {}) {
  return {
    status: opts.status ?? "completed",
    output: [
      {
        status: opts.itemStatus ?? "completed",
        content: [{ type: "output_text", text: typeof outputText === "string" ? outputText : JSON.stringify(outputText) }],
      },
    ],
    usage: { input_tokens: 333, output_tokens: 44 },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides };
}

function baseEnv(): NodeJS.ProcessEnv {
  return fakeEnv({ OPENAI_API_KEY: "sk-test-key", OPENAI_SUMMARY_MODEL: "gpt-5.6-terra" });
}

const MINIMAL_FACTS: MonthFacts = buildMonthFacts({
  orgDocName: "Team Pursuit",
  source: { name: "City of Detroit", docName: null },
  month: "2097-03",
  lineItems: [],
  expensesUpToMonth: [],
  monthExpenses: [],
  settings: { contractValueCents: 0, advancesReceivedCents: 0 },
});

describe("parseWriteSummaryResponse", () => {
  it("valid markdown → written, with usage carried", () => {
    const result = parseWriteSummaryResponse(responsesBody({ markdown: "## Overview\ntext" }));
    expect(result).toEqual({ outcome: "written", markdown: "## Overview\ntext", inputTokens: 333, outputTokens: 44 });
  });

  it("a refusal part → failed, usage still carried", () => {
    const json = {
      status: "completed",
      output: [{ status: "completed", content: [{ type: "refusal", refusal: "cannot help" }] }],
      usage: { input_tokens: 7, output_tokens: 2 },
    };
    const result = parseWriteSummaryResponse(json);
    expect(result).toEqual({ outcome: "failed", inputTokens: 7, outputTokens: 2 });
  });

  it("top-level status 'incomplete' → failed", () => {
    const result = parseWriteSummaryResponse(responsesBody({ markdown: "x" }, { status: "incomplete" }));
    expect(result.outcome).toBe("failed");
  });

  it("an output item's own status not completed → failed", () => {
    const result = parseWriteSummaryResponse(responsesBody({ markdown: "x" }, { itemStatus: "in_progress" }));
    expect(result.outcome).toBe("failed");
  });

  it("malformed JSON text → failed", () => {
    const result = parseWriteSummaryResponse(responsesBody("{not json"));
    expect(result.outcome).toBe("failed");
  });

  it("missing 'markdown' field → failed", () => {
    const result = parseWriteSummaryResponse(responsesBody({ notMarkdown: "x" }));
    expect(result.outcome).toBe("failed");
  });

  it("non-string 'markdown' → failed", () => {
    const result = parseWriteSummaryResponse(responsesBody({ markdown: 12345 }));
    expect(result.outcome).toBe("failed");
  });

  it("empty markdown → failed", () => {
    const result = parseWriteSummaryResponse(responsesBody({ markdown: "" }));
    expect(result.outcome).toBe("failed");
  });

  it("whitespace-only markdown → failed", () => {
    const result = parseWriteSummaryResponse(responsesBody({ markdown: "   \n\t  " }));
    expect(result.outcome).toBe("failed");
  });

  it("markdown is trimmed on success", () => {
    const result = parseWriteSummaryResponse(responsesBody({ markdown: "  ## Overview\ntext  \n" }));
    expect(result.outcome).toBe("written");
    if (result.outcome === "written") expect(result.markdown).toBe("## Overview\ntext");
  });

  it("usage absent entirely → null, null, still a valid outcome", () => {
    const json = {
      status: "completed",
      output: [{ status: "completed", content: [{ type: "output_text", text: JSON.stringify({ markdown: "x" }) }] }],
    };
    const result = parseWriteSummaryResponse(json);
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
  });
});

describe("writeSummary", () => {
  it("sends store:false, the exact SUMMARY_PROMPT as instructions, strict json_schema, model from env, max_output_tokens, and the facts JSON between the delimiters — no retryFeedback when none is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ markdown: "## Overview\ntext" })));
    await writeSummary({ facts: MINIMAL_FACTS }, { fetch: fetchMock, env: baseEnv(), timeoutMs: 5000 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers.Authorization).toBe("Bearer sk-test-key");

    const body = JSON.parse(init.body);
    expect(body.store).toBe(false);
    expect(body.instructions).toBe(SUMMARY_PROMPT);
    expect(body.model).toBe("gpt-5.6-terra");
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.strict).toBe(true);
    expect(body.max_output_tokens).toBe(SUMMARY_MAX_OUTPUT_TOKENS);

    const content = body.input[0].content;
    expect(content).toHaveLength(1); // no retryFeedback given
    expect(content[0].text).toContain("BEGIN MONTH DATA");
    expect(content[0].text).toContain("END MONTH DATA");
    // Money reaches the model only as its printed string, never as raw cents.
    expect(content[0].text).not.toMatch(/"cents"/);

    for (const title of SUMMARY_SECTION_TITLES) {
      expect(SUMMARY_PROMPT).toContain(title);
    }
  });

  it("retryFeedback appended as a second input_text only when given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ markdown: "## Overview\ntext" })));
    await writeSummary(
      { facts: MINIMAL_FACTS, retryFeedback: "Fix your amounts." },
      { fetch: fetchMock, env: baseEnv() },
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const content = body.input[0].content;
    expect(content).toHaveLength(2);
    expect(content[1]).toEqual({ type: "input_text", text: "Fix your amounts." });
  });

  it("HTTP 429 → failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "rate limited" }, 429));
    const result = await writeSummary({ facts: MINIMAL_FACTS }, { fetch: fetchMock, env: baseEnv() });
    expect(result.outcome).toBe("failed");
  });

  it("HTTP 500 → failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 500));
    const result = await writeSummary({ facts: MINIMAL_FACTS }, { fetch: fetchMock, env: baseEnv() });
    expect(result.outcome).toBe("failed");
  });

  it("fetch rejects (network error) → failed", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await writeSummary({ facts: MINIMAL_FACTS }, { fetch: fetchMock, env: baseEnv() });
    expect(result.outcome).toBe("failed");
  });

  it("a fetch that honors the abort signal and never resolves → failed on timeout", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal!;
        signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "TimeoutError";
          reject(err);
        });
      });
    });
    const result = await writeSummary({ facts: MINIMAL_FACTS }, { fetch: fetchMock, env: baseEnv(), timeoutMs: 10 });
    expect(result.outcome).toBe("failed");
  });

  it("non-JSON response body → failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const result = await writeSummary({ facts: MINIMAL_FACTS }, { fetch: fetchMock, env: baseEnv() });
    expect(result.outcome).toBe("failed");
  });

  it("the fetch is given a real AbortSignal (not undefined, not a plain object) — proves a timeout can actually abort it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ markdown: "## Overview\ntext" })));
    await writeSummary({ facts: MINIMAL_FACTS }, { fetch: fetchMock, env: baseEnv(), timeoutMs: 5000 });
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("with no timeoutMs given, the real default (120_000ms) is what bounds the request", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    try {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ markdown: "## Overview\ntext" })));
      await writeSummary({ facts: MINIMAL_FACTS }, { fetch: fetchMock, env: baseEnv() }); // no timeoutMs
      expect(timeoutSpy).toHaveBeenCalledWith(120_000);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("missing API key → failed without calling fetch", async () => {
    const fetchMock = vi.fn();
    const result = await writeSummary(
      { facts: MINIMAL_FACTS },
      { fetch: fetchMock, env: fakeEnv({ OPENAI_API_KEY: undefined, OPENAI_SUMMARY_MODEL: "gpt-5.6-terra" }) },
    );
    expect(result.outcome).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing model → failed without calling fetch", async () => {
    const fetchMock = vi.fn();
    const result = await writeSummary(
      { facts: MINIMAL_FACTS },
      { fetch: fetchMock, env: fakeEnv({ OPENAI_API_KEY: "sk-test", OPENAI_SUMMARY_MODEL: undefined }) },
    );
    expect(result.outcome).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("P16 hard ceiling: a request at exactly SUMMARY_REQUEST_MAX_CHARS is sent, one character over is refused without fetch", async () => {
    const probe = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ markdown: "x" })));
    await writeSummary({ facts: MINIMAL_FACTS }, { fetch: probe, env: baseEnv() });
    const sent = JSON.parse(probe.mock.calls[0][1].body as string);
    const dataLength = (sent.input[0].content[0].text as string).length;

    const atLimit = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ markdown: "x" })));
    await writeSummary(
      { facts: MINIMAL_FACTS, retryFeedback: "r".repeat(SUMMARY_REQUEST_MAX_CHARS - dataLength) },
      { fetch: atLimit, env: baseEnv() },
    );
    expect(atLimit).toHaveBeenCalledTimes(1);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const over = vi.fn();
      const result = await writeSummary(
        { facts: MINIMAL_FACTS, retryFeedback: "r".repeat(SUMMARY_REQUEST_MAX_CHARS - dataLength + 1) },
        { fetch: over, env: baseEnv() },
      );
      expect(result).toEqual({ outcome: "failed", inputTokens: null, outputTokens: null });
      expect(over).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("P16 hard ceiling: an oversized facts payload alone (uncut source name) is refused without fetch", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const huge = buildMonthFacts({
        orgDocName: "Team Pursuit",
        source: { name: "n".repeat(SUMMARY_REQUEST_MAX_CHARS), docName: null },
        month: "2097-03",
        lineItems: [],
        expensesUpToMonth: [],
        monthExpenses: [],
        settings: { contractValueCents: 0, advancesReceivedCents: 0 },
      });
      const fetchMock = vi.fn();
      expect((await writeSummary({ facts: huge }, { fetch: fetchMock, env: baseEnv() })).outcome).toBe("failed");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("never logs the API key or the draft text to console.error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ secret_leak: "sk-test-key", markdown_leak: "some draft text" }, 500));
      await writeSummary({ facts: MINIMAL_FACTS }, { fetch: fetchMock, env: baseEnv() });
      expect(errorSpy).toHaveBeenCalled();
      for (const call of errorSpy.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain("sk-test-key");
        expect(serialized).not.toContain("some draft text");
      }
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("retryFeedbackFor", () => {
  it("lists both problem kinds and the structure problem", () => {
    const feedback = retryFeedbackFor({ amounts: ["$1.00"], percents: ["5%"], structure: "No section headings found." });
    expect(feedback).toContain("$1.00");
    expect(feedback).toContain("5%");
    expect(feedback).toContain("No section headings found.");
  });

  it("null structure reads as 'no problem found'", () => {
    const feedback = retryFeedbackFor({ amounts: ["$1.00"], percents: [], structure: null });
    expect(feedback).toContain("no problem found");
  });

  it("empty amounts/percents lists read as 'none'", () => {
    const feedback = retryFeedbackFor({ amounts: [], percents: [], structure: "bad" });
    expect(feedback).toContain("Dollar amounts not in the supplied data: none.");
    expect(feedback).toContain("Percentages not in the supplied data: none.");
  });

  it("caps each list at 20 entries", () => {
    const amounts = Array.from({ length: 25 }, (_, i) => `$${i}.00`);
    const feedback = retryFeedbackFor({ amounts, percents: [], structure: null });
    for (let i = 0; i < 20; i += 1) expect(feedback).toContain(`$${i}.00`);
    for (let i = 20; i < 25; i += 1) expect(feedback).not.toContain(`$${i}.00`);
  });
});

const bothSummaryPrices = {
  OPENAI_SUMMARY_PRICE_INPUT_PER_MTOK: "2.00",
  OPENAI_SUMMARY_PRICE_OUTPUT_PER_MTOK: "12.00",
};

describe("costMicroUsd — 'summary' feature", () => {
  it("1000 input tokens × $2.00/MTok + 100 output tokens × $12.00/MTok = 3200 micro-USD", () => {
    expect(costMicroUsd(1000, 100, fakeEnv(bothSummaryPrices), "summary")).toBe(3200);
  });

  it("'summary' cost is unaffected by 'read' price envs being set differently", () => {
    const env = fakeEnv({
      ...bothSummaryPrices,
      OPENAI_READ_PRICE_INPUT_PER_MTOK: "999",
      OPENAI_READ_PRICE_OUTPUT_PER_MTOK: "999",
    });
    expect(costMicroUsd(1000, 100, env, "summary")).toBe(3200);
  });

  it("'read' cost (default feature) is unaffected by 'summary' price envs being set differently", () => {
    const env = fakeEnv({
      ...bothSummaryPrices,
      OPENAI_READ_PRICE_INPUT_PER_MTOK: "0.20",
      OPENAI_READ_PRICE_OUTPUT_PER_MTOK: "1.20",
    });
    expect(costMicroUsd(1000, 100, env)).toBe(320);
  });

  it("null when only one of the summary prices is set", () => {
    const env = fakeEnv({ OPENAI_SUMMARY_PRICE_INPUT_PER_MTOK: "2.00", OPENAI_SUMMARY_PRICE_OUTPUT_PER_MTOK: undefined });
    expect(costMicroUsd(1000, 100, env, "summary")).toBeNull();
  });
});
