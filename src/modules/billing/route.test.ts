/**
 * `app/api/stripe/webhook/route.ts` (Phase 16 §4.1). The route's own guards (billing off,
 * missing secret, body cap) plus that a valid signed event reaches the real `handleWebhook`.
 * Follows the request-construction style of `src/modules/monthly-summary/write-route.test.ts`,
 * but the route imports `@/src/modules/billing/sync` directly (not an action), so that module is
 * mocked instead — no DB or real Stripe call happens here.
 */
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/modules/billing/sync", () => ({
  syncOrgBilling: vi.fn(),
  flagDispute: vi.fn(),
}));
vi.mock("@/src/lib/json-request", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/json-request")>("@/src/lib/json-request");
  return { ...actual, readCappedText: vi.fn(actual.readCappedText) };
});

import { readCappedText } from "@/src/lib/json-request";
import { flagDispute, syncOrgBilling } from "@/src/modules/billing/sync";
import { POST } from "@/app/api/stripe/webhook/route";

const syncOrgBillingMock = vi.mocked(syncOrgBilling);
const flagDisputeMock = vi.mocked(flagDispute);
const readCappedTextMock = vi.mocked(readCappedText);

const originalEnv = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

beforeEach(() => {
  resetEnv();
  syncOrgBillingMock.mockReset().mockResolvedValue("synced");
  flagDisputeMock.mockReset().mockResolvedValue("synced");
  readCappedTextMock.mockClear();
});

function request(rawBody: string, opts: { signature?: string | null; contentLength?: string } = {}): Request {
  const headers = new Headers();
  if (opts.signature !== null) headers.set("stripe-signature", opts.signature ?? "irrelevant");
  headers.set("content-length", opts.contentLength ?? String(Buffer.byteLength(rawBody)));
  return new Request("http://localhost/api/stripe/webhook", { method: "POST", body: rawBody, headers });
}

describe("billing off", () => {
  it("returns 503 and never reads the body", async () => {
    process.env.BILLING_ENABLED = "false";
    const response = await POST(request("anything"));
    expect(response.status).toBe(503);
    expect(readCappedTextMock).not.toHaveBeenCalled();
    expect(syncOrgBillingMock).not.toHaveBeenCalled();
  });
});

describe("billing on, no webhook secret configured", () => {
  it("returns 500 before reading the body", async () => {
    process.env.BILLING_ENABLED = "true";
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const response = await POST(request("anything"));
    expect(response.status).toBe(500);
    expect(readCappedTextMock).not.toHaveBeenCalled();
  });

  it("a whitespace-only secret is treated as not configured too (trimmed)", async () => {
    process.env.BILLING_ENABLED = "true";
    process.env.STRIPE_WEBHOOK_SECRET = "   ";
    const response = await POST(request("anything"));
    expect(response.status).toBe(500);
  });
});

describe("body size", () => {
  it("a body over 1 MB is refused with 413, before signature verification", async () => {
    process.env.BILLING_ENABLED = "true";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_route_test";
    const big = "x".repeat(1_000_001);
    const response = await POST(request(big));
    expect(response.status).toBe(413);
    expect(syncOrgBillingMock).not.toHaveBeenCalled();
  });
});

describe("a valid signed event", () => {
  it("reaches the real handleWebhook and dispatches to syncOrgBilling", async () => {
    process.env.BILLING_ENABLED = "true";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_route_test";
    delete process.env.STRIPE_SECRET_KEY; // test mode: stripeKeyIsLive() → false

    const body = JSON.stringify({
      id: "evt_route_1",
      object: "event",
      livemode: false,
      type: "invoice.paid",
      data: { object: { customer: "cus_route_test" } },
    });
    const signer = new Stripe("sk_test_x");
    const signature = signer.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_route_test" });

    const response = await POST(request(body, { signature }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("synced");
    expect(syncOrgBillingMock).toHaveBeenCalledExactlyOnceWith("cus_route_test");
  });

  it("an invalid signature never reaches sync, and returns 400", async () => {
    process.env.BILLING_ENABLED = "true";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_route_test";

    const body = JSON.stringify({ id: "evt_bad", object: "event", livemode: false, type: "invoice.paid", data: { object: {} } });
    const response = await POST(request(body, { signature: "t=1,v1=forged" }));
    expect(response.status).toBe(400);
    expect(syncOrgBillingMock).not.toHaveBeenCalled();
  });
});
