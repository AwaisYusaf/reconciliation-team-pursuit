/**
 * OpenAI Responses API reader (Phase 10 §3.3): the pure response parser, the fetch-driving
 * `readAmounts` with a mocked `fetch`, and `costMicroUsd`. No real network call is ever made.
 */
import sharp from "sharp";
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
    expect(body.max_output_tokens).toBe(2000);
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

  it("a small photo is sent enlarged and cleaned up, not as picked (PHASE-20)", async () => {
    const small = await sharp({ create: { width: 335, height: 597, channels: 3, background: "#c87828" } })
      .jpeg()
      .toBuffer();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ found: false })));
    await readAmounts({ body: small, mimeType: "image/jpeg", kind: "receipt" }, { fetch: fetchMock, env: baseEnv() });
    const filePart = JSON.parse(fetchMock.mock.calls[0][1].body).input[0].content[1];
    const sent = Buffer.from(filePart.image_url.replace("data:image/jpeg;base64,", ""), "base64");
    expect((await sharp(sent).metadata()).height).toBe(2000);
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
      expect(filePart.detail).toBe("high");
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

describe("receipt vendor and date (Phase 19)", () => {
  const TODAY = "2026-09-29";
  const amounts = { money_in: false, subtotal: "80.00", tax: "4.17", fees: "0", total: "84.17" };
  const receipt = (fields: Record<string, unknown>) =>
    parseReadAmountsResponse(responsesBody({ found: true, ...amounts, ...fields }), "receipt", TODAY);

  async function requestBodyFor(kind: "receipt" | "proof") {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ found: false })));
    await readAmounts(
      { body: Buffer.from("pdf-bytes"), mimeType: "application/pdf", kind },
      { fetch: fetchMock, env: baseEnv(), timeoutMs: 5000 },
    );
    return JSON.parse(fetchMock.mock.calls[0][1].body);
  }

  it("a receipt's request requires vendor and date in the strict schema, and the prompt asks for both", async () => {
    const body = await requestBodyFor("receipt");
    const schema = body.text.format.schema;
    expect(schema.required).toEqual(
      expect.arrayContaining(["found", "money_in", "subtotal", "tax", "fees", "total", "vendor", "date"]),
    );
    expect(schema.properties.vendor).toEqual({ type: ["string", "null"] });
    expect(schema.properties.date).toEqual({ type: ["string", "null"] });
    const prompt: string = body.input[0].content[0].text;
    expect(prompt).toContain("vendor is the business or person that was paid");
    expect(prompt).toContain("YYYY-MM-DD");
    expect(prompt).toContain("report both even when found is false");
    expect(body.store).toBe(false);
  });

  it("a proof's request is Phase 10's: no vendor or date in the schema or the prompt", async () => {
    const body = await requestBodyFor("proof");
    const schema = body.text.format.schema;
    expect(schema.required).toEqual(["found", "money_in", "subtotal", "tax", "fees", "total"]);
    expect(schema.properties).not.toHaveProperty("vendor");
    expect(schema.properties).not.toHaveProperty("date");
    expect(body.input[0].content[0].text).not.toContain("vendor");
    // The one thing a proof shares with the receipt change: the raised output cap.
    expect(body.max_output_tokens).toBe(2000);
  });

  it("reads the vendor and date alongside the amounts", () => {
    expect(receipt({ vendor: "Home Depot", date: "2026-09-12" })).toEqual({
      outcome: "found",
      amounts: { subtotalCents: 8000, taxCents: 417, feesCents: 0, totalCents: 8417 },
      details: { vendor: "Home Depot", date: "2026-09-12" },
      inputTokens: 111,
      outputTokens: 22,
    });
  });

  it("keeps them when the document has no amount to read (found: false)", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: false, subtotal: null, tax: null, fees: null, total: null, vendor: "Jane Doe", date: "2026-09-01" }),
      "receipt",
      TODAY,
    );
    expect(result).toEqual({
      outcome: "none",
      details: { vendor: "Jane Doe", date: "2026-09-01" },
      inputTokens: 111,
      outputTokens: 22,
    });
  });

  it("keeps them when the strict money check refuses the amounts ('12,50')", () => {
    const result = receipt({ subtotal: "12,50", total: "12,50", vendor: "Cafe Luna", date: "2026-09-12" });
    expect(result.outcome).toBe("none");
    expect(result).not.toHaveProperty("amounts");
    expect(result).toMatchObject({ details: { vendor: "Cafe Luna", date: "2026-09-12" } });
  });

  it("a proof never carries them, even when the model sends them", () => {
    const result = parseReadAmountsResponse(
      responsesBody({ found: true, ...amounts, vendor: "WAL-MART #2345", date: "2026-09-12" }),
      "proof",
      TODAY,
    );
    expect(result.outcome).toBe("found");
    expect(result).not.toHaveProperty("details");

    // The "none" paths too: a bank line with no amount, or one the money check refuses.
    for (const fields of [{ found: false }, { found: true, ...amounts, subtotal: "12,50", total: "12,50" }]) {
      const none = parseReadAmountsResponse(
        responsesBody({ ...fields, vendor: "WAL-MART #2345", date: "2026-09-12" }),
        "proof",
        TODAY,
      );
      expect(none.outcome).toBe("none");
      expect(none).not.toHaveProperty("details");
    }
  });

  it("a reply with neither has no details key at all, exactly like Phase 10", () => {
    expect(receipt({ vendor: null, date: null })).not.toHaveProperty("details");
    expect(receipt({})).not.toHaveProperty("details");
  });

  it("dates: ISO, US and written-month forms become ISO; impossible dates are refused", () => {
    const dateOf = (date: unknown) => {
      const result = receipt({ vendor: "Home Depot", date });
      return result.outcome === "failed" ? undefined : result.details?.date;
    };
    expect(dateOf("2026-09-12")).toBe("2026-09-12");
    expect(dateOf("09/12/2026")).toBe("2026-09-12");
    expect(dateOf("9-5-2026")).toBe("2026-09-05");
    expect(dateOf("March 18, 2026")).toBe("2026-03-18");
    expect(dateOf("2026-02-30")).toBeNull();
    expect(dateOf("2026-13-01")).toBeNull();
    expect(dateOf("12/09/26")).toBeNull();
    expect(dateOf(20260912)).toBeNull();
  });

  it("dates: today is kept, tomorrow is dropped", () => {
    expect(receipt({ date: TODAY })).toMatchObject({ details: { vendor: null, date: TODAY } });
    expect(receipt({ date: "2026-09-30" })).not.toHaveProperty("details");
  });

  it("vendor: spaces collapsed; empty, letterless, over-long or non-string is null, and the amounts still read", () => {
    const vendorOf = (vendor: unknown) => {
      const result = receipt({ vendor, date: null });
      expect(result.outcome).toBe("found");
      return result.outcome === "failed" ? undefined : (result.details?.vendor ?? null);
    };
    expect(vendorOf("  Home \n  Depot ")).toBe("Home Depot");
    expect(vendorOf("")).toBeNull();
    expect(vendorOf("   ")).toBeNull();
    expect(vendorOf("#2718")).toBeNull();
    expect(vendorOf("A".repeat(121))).toBeNull();
    expect(vendorOf("A".repeat(120))).toBe("A".repeat(120));
    expect(vendorOf(42)).toBeNull();
    expect(vendorOf(["Home Depot"])).toBeNull();
  });

  it("a bad vendor never costs a good date, and the reverse", () => {
    expect(receipt({ vendor: 42, date: "2026-09-12" })).toMatchObject({ details: { vendor: null, date: "2026-09-12" } });
    expect(receipt({ vendor: "Home Depot", date: "soon" })).toMatchObject({ details: { vendor: "Home Depot", date: null } });
  });

  it("a failed read carries nothing", () => {
    const result = parseReadAmountsResponse(
      responsesBody("{not json"),
      "receipt",
      TODAY,
    );
    expect(result).not.toHaveProperty("details");
  });
});
