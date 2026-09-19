/**
 * `/s/[token]` itself (PHASE-12 §6, I-23 on the page): unavailable → the 404 page; open → the file;
 * a notice the file route sent → shown instead of looping back to the file; locked → the password
 * card, with a form-fallback notice passed to it. `openShare` is mocked — its own cases are in the
 * integration suites — so this pins only what the page decides.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/src/modules/sharing/public", async (original) => ({
  ...(await original<typeof import("@/src/modules/sharing/public")>()),
  openShare: vi.fn(),
}));

import SharedLinkPage from "@/app/s/[token]/page";
import { UI } from "@/src/domain/strings";
import { openShare, type PublicShare } from "@/src/modules/sharing/public";

const openShareMock = vi.mocked(openShare);

const share: PublicShare = {
  id: "0190a1b2-0000-7000-8000-000000000001",
  token: "k7Qm2xPa9Xy1",
  passwordHash: "$argon2id$x",
  filename: "Team_Pursuit_March_2026_Packet.pdf",
  kind: "packet",
  s3Key: "org/x/file.pdf",
  sizeBytes: 10,
};

function page(e?: string) {
  return SharedLinkPage({
    params: Promise.resolve({ token: share.token }),
    searchParams: Promise.resolve(e === undefined ? {} : { e }),
  });
}

beforeEach(() => {
  openShareMock.mockReset();
});

describe("the shared link page", () => {
  it("answers every unusable link with the 404 page", async () => {
    openShareMock.mockResolvedValue({ state: "unavailable" });
    await expect(page()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404") });
  });

  it("sends an open link straight to its file", async () => {
    openShareMock.mockResolvedValue({ state: "open", share });
    await expect(page()).rejects.toMatchObject({
      digest: expect.stringContaining(`/s/${share.token}/Team_Pursuit_March_2026_Packet.pdf`),
    });
  });

  it.each(["busy", "unreadable"])("shows the file route's %s notice instead of redirecting back to the file", async (e) => {
    openShareMock.mockResolvedValue({ state: "open", share });
    const element = await page(e);
    expect(JSON.stringify(element.props)).toContain(e === "busy" ? UI.shareTooManyOpens : UI.shareOpenFailed);
  });

  it("still redirects an open link when the notice is only a password one", async () => {
    openShareMock.mockResolvedValue({ state: "open", share });
    await expect(page("wrong")).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });

  it("shows a locked link's password card, carrying a form-fallback notice", async () => {
    openShareMock.mockResolvedValue({ state: "locked", share });
    const element = await page("wait");
    expect(element.props.title).toBe(UI.sharePasswordProtected);
    expect(element.props.children.props).toMatchObject({ token: share.token, kind: "packet", initialError: UI.shareTooManyTries });
  });

  it("ignores anything else in the query", async () => {
    openShareMock.mockResolvedValue({ state: "locked", share });
    const element = await page("constructor");
    expect(element.props.children.props.initialError).toBeNull();
  });
});
