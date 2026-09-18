/**
 * `app/api/monthly-summary/write/route.ts` (Phase 11 §7.1, Appendix A §6). `writeSummaryAction`
 * itself is mocked — this only exercises the route handler's own guards (same-origin, body size,
 * malformed JSON) and that a valid request passes the body through and returns the action's
 * result untouched. Follows the request-construction style of
 * `src/modules/amount-reading/read-amounts.integration.test.ts` (`NextRequest` + headers), but
 * needs no database, so it isn't an `.integration.test.ts`.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/modules/monthly-summary/actions", () => ({
  writeSummaryAction: vi.fn(),
}));
vi.mock("@/src/services/auth/session", () => ({
  getSession: vi.fn(),
}));

import { writeSummaryAction } from "@/src/modules/monthly-summary/actions";
import { getSession } from "@/src/services/auth/session";
import { POST } from "@/app/api/monthly-summary/write/route";

const writeSummaryActionMock = vi.mocked(writeSummaryAction);

const getSessionMock = vi.mocked(getSession);

beforeEach(() => {
  writeSummaryActionMock.mockReset();
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ userId: "u", orgId: "o" } as Awaited<ReturnType<typeof getSession>>);
});

describe("session", () => {
  it("no session → 401 before the body is read, action never called", async () => {
    getSessionMock.mockResolvedValue(null);
    const req = request({ rawBody: "{not json", contentLength: "999999999" });
    const response = await POST(req);
    expect(response.status).toBe(401);
    expect(writeSummaryActionMock).not.toHaveBeenCalled();
  });
});

function request(options: {
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  contentLength?: string;
}): NextRequest {
  const headers = new Headers({ "sec-fetch-site": "same-origin", ...options.headers });
  const body = options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined);
  if (options.contentLength !== undefined) headers.set("content-length", options.contentLength);
  else if (body !== undefined) headers.set("content-length", String(Buffer.byteLength(body)));
  return new NextRequest("http://localhost/api/monthly-summary/write", {
    method: "POST",
    body,
    headers,
  });
}

describe("origin", () => {
  it("cross-origin request → 403, action never called", async () => {
    const req = request({
      body: { sourceId: "s", month: "2096-01", expectedVersion: null },
      headers: { origin: "http://evil.example", host: "localhost" },
    });
    const response = await POST(req);
    expect(response.status).toBe(403);
    expect(writeSummaryActionMock).not.toHaveBeenCalled();
  });
});

describe("body size", () => {
  it("declared content-length over 10,000 → 413, action never called", async () => {
    const req = request({ body: { sourceId: "s", month: "2096-01", expectedVersion: null }, contentLength: "10001" });
    const response = await POST(req);
    expect(response.status).toBe(413);
    expect(writeSummaryActionMock).not.toHaveBeenCalled();
  });

  it("declared content-length exactly at the 10,000 boundary is not rejected on size", async () => {
    writeSummaryActionMock.mockResolvedValue({ ok: true, data: { contentMarkdown: "x", version: 1, writtenBySomeoneElse: false } });
    const req = request({ body: { sourceId: "s", month: "2096-01", expectedVersion: null }, contentLength: "10000" });
    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(writeSummaryActionMock).toHaveBeenCalledTimes(1);
  });
});

describe("malformed body", () => {
  it("invalid JSON → 400, action never called", async () => {
    const req = request({ rawBody: "{not json", contentLength: "9" });
    const response = await POST(req);
    expect(response.status).toBe(400);
    expect(writeSummaryActionMock).not.toHaveBeenCalled();
  });
});

describe("valid request", () => {
  it("passes the parsed body through to writeSummaryAction and returns its result", async () => {
    const actionResult = { ok: true as const, data: { contentMarkdown: "hello", version: 3, writtenBySomeoneElse: false } };
    writeSummaryActionMock.mockResolvedValue(actionResult);

    const body = { sourceId: "abc-123", month: "2096-02", expectedVersion: 2 };
    const req = request({ body });
    const response = await POST(req);

    expect(writeSummaryActionMock).toHaveBeenCalledWith(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(actionResult);
  });

  it("passes through a failure result from the action unchanged, still 200", async () => {
    const actionResult = { ok: false as const, error: "Some refusal." };
    writeSummaryActionMock.mockResolvedValue(actionResult);

    const req = request({ body: { sourceId: "abc", month: "2096-02", expectedVersion: null } });
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(actionResult);
  });
});
