/**
 * OpenAI Responses API reader (Phase 10 §3.3): the pure response parser, the fetch-driving
 * `readAmounts` with a mocked `fetch`, and `costMicroUsd`. No real network call is ever made.
 */
import { describe, expect, it, vi } from "vitest";

import { parseReadAmountsResponse, readAmounts } from "./read-amounts";
import { costMicroUsd } from "./responses";

function responsesBody(outputText: unknown, opts: { status?: string; itemStatus?: string } = {}) {
  return {
    status: opts.status ?? "completed",
    output: [
      {
        status: opts.itemStatus ?? "completed",
        content: [{ type: "output_text", text: typeof outputText === "string" ? outputText : JSON.stringify(outputText) }],
      },
    ],
    usage: { input_tokens: 111, output_tokens: 22 },
  };
}

describe("parseReadAmountsResponse", () => {
  it("valid found: converts decimal strings to cents", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: "110.00", tax: "6.60", fees: "3.40", total: "120.00" }),
    );
    expect(result).toEqual({
      outcome: "found",
      amounts: { subtotalCents: 11000, taxCents: 660, feesCents: 340, totalCents: 12000 },
      inputTokens: 111,
      outputTokens: 22,
    });
  });

  it("parses a comma-grouped dollar string", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: "1,234.50", tax: null, fees: null, total: null }),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") expect(result.amounts.subtotalCents).toBe(123450);
  });

  it("parses a negative amount (refund)", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: "-12.00", tax: null, fees: null, total: null }),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") expect(result.amounts.subtotalCents).toBe(-1200);
  });

  it("found: false → none", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: false, subtotal: null, tax: null, fees: null, total: null }),
    );
    expect(result.outcome).toBe("none");
  });

  it("a refusal part → failed", () => {
    const json = {
      status: "completed",
      output: [{ status: "completed", content: [{ type: "refusal", refusal: "cannot help" }] }],
      usage: { input_tokens: 5, output_tokens: 1 },
    };
    const result = parseReadAmountsResponse(json);
    expect(result.outcome).toBe("failed");
    expect(result.inputTokens).toBe(5);
    expect(result.outputTokens).toBe(1);
  });

  it("missing output_text → failed", () => {
    const json = { status: "completed", output: [{ status: "completed", content: [] }] };
    expect(parseReadAmountsResponse(json).outcome).toBe("failed");
  });

  it("malformed JSON text → failed", () => {
    const result = parseReadAmountsResponse(responsesBody("{not json"));
    expect(result.outcome).toBe("failed");
  });

  it("top-level status 'incomplete' → failed", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: "1.00", tax: null, fees: null, total: null }, { status: "incomplete" }),
    );
    expect(result.outcome).toBe("failed");
  });

  it("an output item's own status not completed → failed", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: "1.00", tax: null, fees: null, total: null }, { itemStatus: "in_progress" }),
    );
    expect(result.outcome).toBe("failed");
  });

  it("non-numeric strings ('abc') → none", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: "abc", tax: null, fees: null, total: "10.00" }),
    );
    expect(result.outcome).toBe("none");
  });

  it("non-numeric strings ('12.3.4', two decimal points) → none", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: "12.3.4", tax: null, fees: null, total: "10.00" }),
    );
    expect(result.outcome).toBe("none");
  });

  it("STRICT_DECIMAL: a European-style comma decimal ('12,50') is refused, never silently read as $1,250", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: "12,50", tax: null, fees: null, total: "10.00" }),
    );
    expect(result.outcome).toBe("none");
  });

  it("STRICT_DECIMAL: a fully European-formatted amount ('1.234,56') is refused", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: "1.234,56", tax: null, fees: null, total: "10.00" }),
    );
    expect(result.outcome).toBe("none");
  });

  it("STRICT_DECIMAL: a US-grouped decimal ('1,234.56') is accepted as $1,234.56", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: "1,234.56", tax: null, fees: null, total: null }),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") expect(result.amounts.subtotalCents).toBe(123456);
  });

  it("tax/fees null → treated as 0", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: "10.00", tax: null, fees: null, total: "10.00" }),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.amounts.taxCents).toBe(0);
      expect(result.amounts.feesCents).toBe(0);
    }
  });

  it("subtotal null + total present → subtotal derived (total - tax - fees)", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: null, tax: "1.00", fees: "1.00", total: "10.00" }),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.amounts.subtotalCents).toBe(800);
      expect(result.amounts.totalCents).toBe(1000);
    }
  });

  it("total null + subtotal present → total derived (subtotal + tax + fees)", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: "8.00", tax: "1.00", fees: "1.00", total: null }),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.amounts.totalCents).toBe(1000);
      expect(result.amounts.subtotalCents).toBe(800);
    }
  });

  it("both subtotal and total null → none", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: null, tax: "1.00", fees: null, total: null }),
    );
    expect(result.outcome).toBe("none");
  });

  it("wrong types (number instead of string) → none", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, subtotal: 120, tax: null, fees: null, total: null }),
    );
    expect(result.outcome).toBe("none");
  });

  it("usage tokens extracted when present, null when absent", () => {
    const withUsage = parseReadAmountsResponse(
      responsesBody({ found: false, subtotal: null, tax: null, fees: null, total: null }),
    );
    expect(withUsage.inputTokens).toBe(111);
    expect(withUsage.outputTokens).toBe(22);

    const noUsageJson = {
      status: "completed",
      output: [{ status: "completed", content: [{ type: "output_text", text: JSON.stringify({ found: false }) }] }],
    };
    const withoutUsage = parseReadAmountsResponse(noUsageJson);
    expect(withoutUsage.inputTokens).toBeNull();
    expect(withoutUsage.outputTokens).toBeNull();
  });

  it("non-object json → failed", () => {
    expect(parseReadAmountsResponse(null).outcome).toBe("failed");
    expect(parseReadAmountsResponse("a string").outcome).toBe("failed");
    expect(parseReadAmountsResponse(42).outcome).toBe("failed");
  });

  it("output not an array → failed", () => {
    expect(parseReadAmountsResponse({ status: "completed", output: "nope" }).outcome).toBe("failed");
  });

  it("parsed JSON missing 'found' boolean → failed", () => {
    const result = parseReadAmountsResponse(responsesBody({ subtotal: "1.00" }));
    expect(result.outcome).toBe("failed");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A minimal fake `process.env` for a test, without the `NODE_ENV` etc. `NodeJS.ProcessEnv`
 *  otherwise requires — spread over the real env so the result is genuinely assignable. */
function fakeEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides };
}

function baseEnv(): NodeJS.ProcessEnv {
  return fakeEnv({ OPENAI_API_KEY: "sk-test-key", OPENAI_READ_MODEL: "gpt-5.6-luna" });
}

describe("readAmounts", () => {
  it("sends store:false, strict json_schema, the model from env, and a Bearer key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ found: false })));
    await readAmounts(
      { body: Buffer.from("pdf-bytes"), mimeType: "application/pdf", kind: "receipt" },
      { fetch: fetchMock, env: baseEnv(), timeoutMs: 5000 },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers.Authorization).toBe("Bearer sk-test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.store).toBe(false);
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.strict).toBe(true);
    expect(body.max_output_tokens).toBe(400);
  });

  it("PDF → input_file with the generic filename 'document.pdf', never the user's own", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ found: false })));
    await readAmounts(
      { body: Buffer.from("pdf-bytes"), mimeType: "application/pdf", kind: "receipt" },
      { fetch: fetchMock, env: baseEnv() },
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const filePart = body.input[0].content[1];
    expect(filePart.type).toBe("input_file");
    expect(filePart.filename).toBe("document.pdf");
    expect(filePart.file_data).toContain("data:application/pdf;base64,");
  });

  it("PNG/JPEG → input_image with a data URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ found: false })));
    for (const mimeType of ["image/png", "image/jpeg"] as const) {
      fetchMock.mockClear();
      await readAmounts(
        { body: Buffer.from("img-bytes"), mimeType, kind: "proof" },
        { fetch: fetchMock, env: baseEnv() },
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const filePart = body.input[0].content[1];
      expect(filePart.type).toBe("input_image");
      expect(filePart.image_url).toContain(`data:${mimeType};base64,`);
    }
  });

  it("unsupported mime type → failed without calling fetch", async () => {
    const fetchMock = vi.fn();
    const result = await readAmounts(
      { body: Buffer.from("x"), mimeType: "application/zip", kind: "receipt" },
      { fetch: fetchMock, env: baseEnv() },
    );
    expect(result.outcome).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing API key → failed without calling fetch", async () => {
    const fetchMock = vi.fn();
    const result = await readAmounts(
      { body: Buffer.from("x"), mimeType: "application/pdf", kind: "receipt" },
      { fetch: fetchMock, env: fakeEnv({ OPENAI_API_KEY: undefined, OPENAI_READ_MODEL: "gpt-5.6-luna" }) },
    );
    expect(result.outcome).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing model → failed without calling fetch", async () => {
    const fetchMock = vi.fn();
    const result = await readAmounts(
      { body: Buffer.from("x"), mimeType: "application/pdf", kind: "receipt" },
      { fetch: fetchMock, env: fakeEnv({ OPENAI_API_KEY: "sk-test", OPENAI_READ_MODEL: undefined }) },
    );
    expect(result.outcome).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HTTP 500 → failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 500));
    const result = await readAmounts(
      { body: Buffer.from("x"), mimeType: "application/pdf", kind: "receipt" },
      { fetch: fetchMock, env: baseEnv() },
    );
    expect(result.outcome).toBe("failed");
  });

  it("HTTP 429 → failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "rate limited" }, 429));
    const result = await readAmounts(
      { body: Buffer.from("x"), mimeType: "application/pdf", kind: "receipt" },
      { fetch: fetchMock, env: baseEnv() },
    );
    expect(result.outcome).toBe("failed");
  });

  it("fetch rejects (network error) → failed", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await readAmounts(
      { body: Buffer.from("x"), mimeType: "application/pdf", kind: "receipt" },
      { fetch: fetchMock, env: baseEnv() },
    );
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
    const result = await readAmounts(
      { body: Buffer.from("x"), mimeType: "application/pdf", kind: "receipt" },
      { fetch: fetchMock, env: baseEnv(), timeoutMs: 10 },
    );
    expect(result.outcome).toBe("failed");
  });

  it("non-JSON response body → failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const result = await readAmounts(
      { body: Buffer.from("x"), mimeType: "application/pdf", kind: "receipt" },
      { fetch: fetchMock, env: baseEnv() },
    );
    expect(result.outcome).toBe("failed");
  });

  it("the fetch is given a real AbortSignal (not undefined, not a plain object) — proves a timeout can actually abort it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ found: false })));
    await readAmounts(
      { body: Buffer.from("x"), mimeType: "application/pdf", kind: "receipt" },
      { fetch: fetchMock, env: baseEnv(), timeoutMs: 5000 },
    );
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("with no timeoutMs given, the real default (60_000ms) is what bounds the request", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    try {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ found: false })));
      await readAmounts(
        { body: Buffer.from("x"), mimeType: "application/pdf", kind: "receipt" },
        { fetch: fetchMock, env: baseEnv() }, // no timeoutMs
      );
      expect(timeoutSpy).toHaveBeenCalledWith(60_000);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("never logs the API key, amounts, or response body text to console.error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ secret_leak: "sk-test-key", amount_leak: "$999.99" }, 500));
      await readAmounts(
        { body: Buffer.from("x"), mimeType: "application/pdf", kind: "receipt" },
        { fetch: fetchMock, env: baseEnv() },
      );
      expect(errorSpy).toHaveBeenCalled();
      for (const call of errorSpy.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain("sk-test-key");
        expect(serialized).not.toContain("999.99");
      }
    } finally {
      errorSpy.mockRestore();
    }
  });
});

const bothPrices = { OPENAI_READ_PRICE_INPUT_PER_MTOK: "0.20", OPENAI_READ_PRICE_OUTPUT_PER_MTOK: "1.20" };

describe("costMicroUsd", () => {
  it("Appendix pricing: 1000 input tokens × $0.20/MTok + 100 output tokens × $1.20/MTok = 320 micro-USD", () => {
    expect(costMicroUsd(1000, 100, fakeEnv(bothPrices))).toBe(320);
  });

  it("null when input tokens are null", () => {
    expect(costMicroUsd(null, 100, fakeEnv(bothPrices))).toBeNull();
  });

  it("null when output tokens are null", () => {
    expect(costMicroUsd(1000, null, fakeEnv(bothPrices))).toBeNull();
  });

  it("null when prices are entirely unset — tokens still 'logged' by the caller, cost simply absent", () => {
    const env = fakeEnv({
      OPENAI_READ_PRICE_INPUT_PER_MTOK: undefined,
      OPENAI_READ_PRICE_OUTPUT_PER_MTOK: undefined,
    });
    expect(costMicroUsd(1000, 100, env)).toBeNull();
  });

  it("null when only one price is set", () => {
    const env = fakeEnv({
      OPENAI_READ_PRICE_INPUT_PER_MTOK: "0.20",
      OPENAI_READ_PRICE_OUTPUT_PER_MTOK: undefined,
    });
    expect(costMicroUsd(1000, 100, env)).toBeNull();
  });

  it("null when a price is invalid (non-numeric)", () => {
    const env = fakeEnv({
      OPENAI_READ_PRICE_INPUT_PER_MTOK: "abc",
      OPENAI_READ_PRICE_OUTPUT_PER_MTOK: "1.20",
    });
    expect(costMicroUsd(1000, 100, env)).toBeNull();
  });

  it("null when a price is negative", () => {
    const env = fakeEnv({
      OPENAI_READ_PRICE_INPUT_PER_MTOK: "-0.20",
      OPENAI_READ_PRICE_OUTPUT_PER_MTOK: "1.20",
    });
    expect(costMicroUsd(1000, 100, env)).toBeNull();
  });

  it("zero tokens with valid prices → 0, not null", () => {
    expect(costMicroUsd(0, 0, fakeEnv(bothPrices))).toBe(0);
  });
});

describe("proof direction (PR #18 round 2, #5): size from the amount, sign from money_in", () => {
  const proof = (fields: Record<string, unknown>) =>
    parseReadAmountsResponse(responsesBody({ found: true, tax: "0", fees: "0", ...fields }), "proof");

  it("a payment is positive however the bank writes it", () => {
    for (const written of ["165.00", "-165.00"]) {
      expect(proof({ money_in: false, subtotal: written, total: written })).toMatchObject({
        amounts: { subtotalCents: 16500, totalCents: 16500 },
      });
    }
  });

  it("money coming in is negative, like the refund receipt it matches", () => {
    for (const written of ["145.00", "-145.00"]) {
      expect(proof({ money_in: true, subtotal: written, total: written })).toMatchObject({
        amounts: { subtotalCents: -14500, totalCents: -14500 },
      });
    }
  });

  it("a zero never becomes -0", () => {
    const result = proof({ money_in: true, subtotal: "10.00", total: "10.00" });
    expect(result.outcome === "found" && Object.is(result.amounts.taxCents, 0)).toBe(true);
  });

  it("a receipt keeps its own sign; money_in only applies to proofs", () => {
    const refund = parseReadAmountsResponse(
      responsesBody({ found: true, money_in: true, subtotal: "-145.00", tax: "0", fees: "0", total: "-145.00" }),
      "receipt",
    );
    expect(refund).toMatchObject({ amounts: { totalCents: -14500 } });
    const purchase = parseReadAmountsResponse(
      responsesBody({ found: true, money_in: true, subtotal: "145.00", tax: "0", fees: "0", total: "145.00" }),
      "receipt",
    );
    expect(purchase).toMatchObject({ amounts: { totalCents: 14500 } });
  });
});
