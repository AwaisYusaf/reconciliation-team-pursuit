/**
 * OpenAI invoice reader (Phase 14 §2): the pure response parser, and `readInvoice` with a mocked
 * `fetch`. No real network call is ever made.
 */
import { describe, expect, it, vi } from "vitest";

import { MAX_INVOICE_LINES, parseReadInvoiceResponse, readInvoice } from "./read-invoice";

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

function line(overrides: Record<string, unknown> = {}) {
  return { name: "Widget", description: "One widget", amount: "10.00", tax: "1.00", fees: "0.50", ...overrides };
}

function invoiceBody(lines: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    found: true,
    vendor: "Acme Co",
    invoice_date: "2026-01-05",
    bill_tax: null,
    bill_fees: null,
    lines,
    ...overrides,
  };
}

describe("parseReadInvoiceResponse", () => {
  it("0 lines → none", () => {
    const result = parseReadInvoiceResponse(responsesBody(invoiceBody([])));
    expect(result.outcome).toBe("none");
  });

  it("exactly 50 lines → found, not truncated, all 50 kept", () => {
    const lines = Array.from({ length: 50 }, (_, i) => line({ name: `Item ${i}` }));
    const result = parseReadInvoiceResponse(responsesBody(invoiceBody(lines)));
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.truncated).toBe(false);
      expect(result.invoice.lines).toHaveLength(50);
    }
  });

  it("51 lines → capped to 50 and truncated true", () => {
    const lines = Array.from({ length: 51 }, (_, i) => line({ name: `Item ${i}` }));
    const result = parseReadInvoiceResponse(responsesBody(invoiceBody(lines)));
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.truncated).toBe(true);
      expect(result.invoice.lines).toHaveLength(MAX_INVOICE_LINES);
    }
  });

  it("a line with no amount is dropped, without failing the rest of the invoice", () => {
    const result = parseReadInvoiceResponse(
      responsesBody(invoiceBody([line({ amount: null }), line({ name: "Kept" })])),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.invoice.lines).toHaveLength(1);
      expect(result.invoice.lines[0].name).toBe("Kept");
    }
  });

  it("a $0.00 line is kept", () => {
    const result = parseReadInvoiceResponse(responsesBody(invoiceBody([line({ amount: "0.00" })])));
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") expect(result.invoice.lines[0].subtotalCents).toBe(0);
  });

  it("a negative (refund/credit) line is kept", () => {
    const result = parseReadInvoiceResponse(responsesBody(invoiceBody([line({ amount: "-12.00" })])));
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") expect(result.invoice.lines[0].subtotalCents).toBe(-1200);
  });

  it("malformed model JSON → failed", () => {
    const result = parseReadInvoiceResponse(responsesBody("{not json"));
    expect(result.outcome).toBe("failed");
  });

  it("a non-decimal amount like '12,50' is dropped, never read as $1,250.00", () => {
    const result = parseReadInvoiceResponse(responsesBody(invoiceBody([line({ amount: "12,50" })])));
    // The only line drops out, so the whole read resolves to "none" — never a $1,250 line.
    expect(result.outcome).toBe("none");
  });

  it("missing optional fields (description/tax/fees/vendor/invoice_date null) get sane defaults", () => {
    const result = parseReadInvoiceResponse(
      responsesBody(
        invoiceBody([{ name: null, description: null, amount: "5.00", tax: null, fees: null }], {
          vendor: null,
          invoice_date: null,
        }),
      ),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.invoice.vendor).toBeNull();
      expect(result.invoice.invoiceDate).toBeNull();
      expect(result.invoice.lines[0]).toMatchObject({
        name: "",
        description: "",
        subtotalCents: 500,
        taxCents: 0,
        feesCents: 0,
      });
    }
  });

  it("found: false → none", () => {
    const result = parseReadInvoiceResponse(responsesBody({ found: false }));
    expect(result.outcome).toBe("none");
  });

  it("a refusal part → failed", () => {
    const json = {
      status: "completed",
      output: [{ status: "completed", content: [{ type: "refusal", refusal: "cannot help" }] }],
      usage: { input_tokens: 5, output_tokens: 1 },
    };
    const result = parseReadInvoiceResponse(json);
    expect(result.outcome).toBe("failed");
    expect(result.inputTokens).toBe(5);
    expect(result.outputTokens).toBe(1);
  });

  it("status not 'completed' → failed", () => {
    const result = parseReadInvoiceResponse(responsesBody(invoiceBody([line()]), { status: "incomplete" }));
    expect(result.outcome).toBe("failed");
  });

  it("lines missing entirely is treated as an empty array, not a throw", () => {
    const json = invoiceBody([]) as Record<string, unknown>;
    delete json.lines;
    const result = parseReadInvoiceResponse(responsesBody(json));
    expect(result.outcome).toBe("none");
  });

  it("lines not an array is treated as an empty array, not a throw", () => {
    const withBadLines = { ...invoiceBody([]), lines: "not-an-array" };
    const result = parseReadInvoiceResponse(responsesBody(withBadLines));
    expect(result.outcome).toBe("none");
  });

  it("non-object entries (a string, null) mixed with good lines are skipped, not thrown", () => {
    const result = parseReadInvoiceResponse(
      responsesBody(invoiceBody(["a string line", null, 42, line({ name: "Kept" })])),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.invoice.lines).toHaveLength(1);
      expect(result.invoice.lines[0].name).toBe("Kept");
    }
  });

  it("51 lines where every one of the first 50 is unparsable resolves to 'none' and drops truncated (pinned current behaviour)", () => {
    // Ticket text says a >50-line invoice should say "the first 50 were read" — but if every one
    // of those first 50 lines fails the amount guard, the code currently falls through to the
    // same `{ outcome: "none" }` used for "nothing found at all", silently losing the fact that
    // there was a 51st (truncated) line and losing the "add the rest by hand" messaging. This test
    // pins that behaviour as-is; it is not asserting it's correct. See report for judgement call.
    const unparsableFirst50 = Array.from({ length: 50 }, () => line({ amount: "12,50" }));
    const goodLine51 = line({ amount: "10.00", name: "Line 51" });
    const result = parseReadInvoiceResponse(responsesBody(invoiceBody([...unparsableFirst50, goodLine51])));
    expect(result.outcome).toBe("none");
    expect("truncated" in result).toBe(false);
  });

  it("found as a string 'true' is not a real found:true → failed", () => {
    const result = parseReadInvoiceResponse(responsesBody({ found: "true", vendor: null }));
    expect(result.outcome).toBe("failed");
  });

  it("found as 1 (truthy number, not boolean) → failed", () => {
    const result = parseReadInvoiceResponse(responsesBody({ found: 1 }));
    expect(result.outcome).toBe("failed");
  });

  it("found missing entirely → failed", () => {
    const result = parseReadInvoiceResponse(responsesBody({ vendor: "Acme" }));
    expect(result.outcome).toBe("failed");
  });

  it("bill_tax and bill_fees: valid strings become cents", () => {
    const result = parseReadInvoiceResponse(
      responsesBody(invoiceBody([line()], { bill_tax: "12.50", bill_fees: "3.00" })),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.invoice.billTaxCents).toBe(1250);
      expect(result.invoice.billFeesCents).toBe(300);
    }
  });

  it("bill_tax and bill_fees: an unparsable string ('12,50') drops to null rather than failing the read", () => {
    const result = parseReadInvoiceResponse(
      responsesBody(invoiceBody([line()], { bill_tax: "12,50", bill_fees: "12,50" })),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.invoice.billTaxCents).toBeNull();
      expect(result.invoice.billFeesCents).toBeNull();
    }
  });

  it("bill_tax and bill_fees: null stays null", () => {
    const result = parseReadInvoiceResponse(
      responsesBody(invoiceBody([line()], { bill_tax: null, bill_fees: null })),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.invoice.billTaxCents).toBeNull();
      expect(result.invoice.billFeesCents).toBeNull();
    }
  });

  it("a line's unparsable tax ('12,50') drops that line, never reads it as $0.00 tax", () => {
    // Reading a refused amount as zero would quietly understate money on an expense the City
    // reads, and it could not be told apart from a line that truly had no tax (D-110). The line
    // is dropped instead, and the good line beside it is kept.
    const result = parseReadInvoiceResponse(
      responsesBody(
        invoiceBody([
          line({ name: "Bad tax", amount: "10.00", tax: "12,50", fees: "1.00" }),
          line({ name: "Good", amount: "20.00", tax: "2.00", fees: null }),
        ]),
      ),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.invoice.lines).toHaveLength(1);
      expect(result.invoice.lines[0].name).toBe("Good");
      expect(result.invoice.lines[0].taxCents).toBe(200);
      expect(result.invoice.lines[0].feesCents).toBe(0);
    }
  });

  it("a line's unparsable fees ('12,50') drops that line too, same treatment as tax", () => {
    const result = parseReadInvoiceResponse(
      responsesBody(invoiceBody([line({ amount: "10.00", tax: "1.00", fees: "12,50" })])),
    );
    // The only line is dropped, so there is nothing left to draft.
    expect(result.outcome).toBe("none");
  });

  it("a wrong-typed tax (a number, not a string) drops the line rather than reading it as $0.00", () => {
    const result = parseReadInvoiceResponse(
      responsesBody(invoiceBody([{ name: "N", description: "D", amount: "10.00", tax: 12.5, fees: null }])),
    );
    expect(result.outcome).toBe("none");
  });

  it("absent tax and fees stay a real 0, they are not confused with a refused value", () => {
    const result = parseReadInvoiceResponse(
      responsesBody(invoiceBody([line({ amount: "10.00", tax: null, fees: null })])),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.invoice.lines).toHaveLength(1);
      expect(result.invoice.lines[0].taxCents).toBe(0);
      expect(result.invoice.lines[0].feesCents).toBe(0);
    }
  });

  it("5000 lines in the reply still caps at 50 and returns promptly", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => line({ name: `Item ${i}` }));
    const start = performance.now();
    const result = parseReadInvoiceResponse(responsesBody(invoiceBody(lines)));
    const elapsedMs = performance.now() - start;
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.truncated).toBe(true);
      expect(result.invoice.lines).toHaveLength(MAX_INVOICE_LINES);
    }
    // Generous bound — this is a guard against an accidental O(n^2) pass over the full 5000-line
    // array, not a tight performance assertion.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it.each([
    ["0", 0],
    ["1,234.56", 123456],
    ["99,999,999.99", 9999999999],
  ])("amount boundary %s is kept as %i cents", (amount, cents) => {
    const result = parseReadInvoiceResponse(responsesBody(invoiceBody([line({ amount })])));
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") expect(result.invoice.lines[0].subtotalCents).toBe(cents);
  });

  it("amount boundary -0.00 is kept and reads as zero (±0, arithmetically equal)", () => {
    // toBe/Object.is distinguishes -0 from 0, but modelAmountToCents' own arithmetic (`===`) does
    // not, and neither does storing it as an integer cents column — so this is asserted with a
    // numeric comparison rather than toBe, which would spuriously fail on -0.
    const result = parseReadInvoiceResponse(responsesBody(invoiceBody([line({ amount: "-0.00" })])));
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") expect(result.invoice.lines[0].subtotalCents === 0).toBe(true);
  });

  it.each(["0.001", "1234.567"])("amount boundary %s (too many decimals) is dropped", (amount) => {
    const result = parseReadInvoiceResponse(responsesBody(invoiceBody([line({ amount })])));
    // The only line drops out, so the whole read resolves to "none".
    expect(result.outcome).toBe("none");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides };
}

function baseEnv(): NodeJS.ProcessEnv {
  return fakeEnv({ OPENAI_API_KEY: "sk-test-key", OPENAI_READ_MODEL: "gpt-5.6-luna" });
}

describe("readInvoice", () => {
  it("a non-PDF mime type → failed without calling fetch", async () => {
    const fetchMock = vi.fn();
    const result = await readInvoice(
      { body: Buffer.from("img-bytes"), mimeType: "image/jpeg" },
      { fetch: fetchMock, env: baseEnv() },
    );
    expect(result.outcome).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends store:false, the generic 'document.pdf' filename, and a 4000-token cap", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsesBody({ found: false })));
    await readInvoice(
      { body: Buffer.from("pdf-bytes"), mimeType: "application/pdf" },
      { fetch: fetchMock, env: baseEnv(), timeoutMs: 5000 },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBe(4000);
    const filePart = body.input[0].content[1];
    expect(filePart.type).toBe("input_file");
    expect(filePart.filename).toBe("document.pdf");
    expect(filePart.file_data).toContain("data:application/pdf;base64,");
  });

  it("missing API key or model → failed without calling fetch", async () => {
    const fetchMock = vi.fn();
    const result = await readInvoice(
      { body: Buffer.from("x"), mimeType: "application/pdf" },
      { fetch: fetchMock, env: fakeEnv({ OPENAI_API_KEY: undefined, OPENAI_READ_MODEL: "gpt-5.6-luna" }) },
    );
    expect(result.outcome).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HTTP 500 → failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 500));
    const result = await readInvoice(
      { body: Buffer.from("x"), mimeType: "application/pdf" },
      { fetch: fetchMock, env: baseEnv() },
    );
    expect(result.outcome).toBe("failed");
  });

  it("fetch rejects (network error) → failed", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await readInvoice(
      { body: Buffer.from("x"), mimeType: "application/pdf" },
      { fetch: fetchMock, env: baseEnv() },
    );
    expect(result.outcome).toBe("failed");
  });

  it("non-JSON response body → failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const result = await readInvoice(
      { body: Buffer.from("x"), mimeType: "application/pdf" },
      { fetch: fetchMock, env: baseEnv() },
    );
    expect(result.outcome).toBe("failed");
  });
});
