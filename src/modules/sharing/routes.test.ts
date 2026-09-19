/**
 * `POST /api/shared-links/create` and `/update` (PHASE-12 P12). The actions are mocked: this only
 * exercises what the routes add for themselves — session, origin, body size, malformed JSON — and
 * that a valid body reaches the action untouched. The actions' own checks are in
 * `actions.integration.test.ts`. Style follows `monthly-summary/write-route.test.ts`.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/modules/sharing/actions", () => ({
  createSharedLinkAction: vi.fn(),
  updateSharedFileAction: vi.fn(),
}));
vi.mock("@/src/services/auth/session", () => ({ getSession: vi.fn() }));

import { POST as createPost } from "@/app/api/shared-links/create/route";
import { POST as updatePost } from "@/app/api/shared-links/update/route";
import { createSharedLinkAction, updateSharedFileAction } from "@/src/modules/sharing/actions";
import { getSession } from "@/src/services/auth/session";

const getSessionMock = vi.mocked(getSession);

const ROUTES = [
  {
    name: "create",
    post: createPost,
    action: vi.mocked(createSharedLinkAction),
    body: { fundingSourceId: "s", month: "2081-03", kind: "packet", password: null, confirmedDeletions: false },
  },
  {
    name: "update",
    post: updatePost,
    action: vi.mocked(updateSharedFileAction),
    body: { shareId: "id", confirmedDeletions: true },
  },
] as const;

function request(options: { body?: unknown; rawBody?: string; headers?: Record<string, string>; contentLength?: string }) {
  const headers = new Headers({ "sec-fetch-site": "same-origin", ...options.headers });
  const body = options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined);
  if (options.contentLength !== undefined) headers.set("content-length", options.contentLength);
  else if (body !== undefined) headers.set("content-length", String(Buffer.byteLength(body)));
  return new NextRequest("http://localhost/api/shared-links/x", { method: "POST", body, headers });
}

beforeEach(() => {
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ userId: "u", orgId: "o" } as Awaited<ReturnType<typeof getSession>>);
  for (const { action } of ROUTES) {
    action.mockReset();
    action.mockResolvedValue({ ok: true, data: undefined } as never);
  }
});

describe.each(ROUTES)("$name route", ({ post, action, body }) => {
  it("401 before the body is read when signed out", async () => {
    getSessionMock.mockResolvedValue(null);
    const response = await post(request({ rawBody: "{not json", contentLength: "999999999" }));
    expect(response.status).toBe(401);
    expect(action).not.toHaveBeenCalled();
  });

  it("403 on a cross-origin request", async () => {
    const response = await post(request({ body, headers: { origin: "http://evil.example", host: "localhost" } }));
    expect(response.status).toBe(403);
    expect(action).not.toHaveBeenCalled();
  });

  it("413 past 2,000 bytes", async () => {
    const response = await post(request({ body, contentLength: "2001" }));
    expect(response.status).toBe(413);
    expect(action).not.toHaveBeenCalled();
  });

  it("400 on malformed JSON", async () => {
    const response = await post(request({ rawBody: "{not json" }));
    expect(response.status).toBe(400);
    expect(action).not.toHaveBeenCalled();
  });

  it("passes a valid body to the action and returns its result untouched", async () => {
    action.mockResolvedValue({ ok: false, error: "That file is already shared." } as never);
    const response = await post(request({ body }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false, error: "That file is already shared." });
    expect(action).toHaveBeenCalledWith(body);
  });
});
