/** How the public password form reads the unlock route's answer (`app/s/[token]/unlock-answer.ts`). */
import { describe, expect, it } from "vitest";

import { readUnlockAnswer } from "@/app/s/[token]/unlock-answer";
import { UI } from "@/src/domain/strings";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("readUnlockAnswer", () => {
  it("passes the file URL through on success", async () => {
    expect(await readUnlockAnswer(json({ ok: true, url: "/s/T/a.pdf" }))).toEqual({ ok: true, url: "/s/T/a.pdf" });
  });

  it("shows the route's own wording on a refusal", async () => {
    expect(await readUnlockAnswer(json({ ok: false, error: UI.shareTooManyTries }, 429))).toEqual({
      ok: false,
      error: UI.shareTooManyTries,
    });
  });

  it("never navigates anywhere but a shared-link URL", async () => {
    expect(await readUnlockAnswer(json({ ok: true, url: "https://evil.example/" }))).toEqual({
      ok: false,
      error: UI.shareOpenFailed,
    });
  });

  it("turns anything that isn't the route's JSON into plain wording", async () => {
    const html = new Response("<html>502</html>", { status: 502, headers: { "content-type": "text/html" } });
    expect(await readUnlockAnswer(html)).toEqual({ ok: false, error: UI.shareOpenFailed });
    const broken = new Response("{nope", { headers: { "content-type": "application/json" } });
    expect(await readUnlockAnswer(broken)).toEqual({ ok: false, error: UI.shareOpenFailed });
  });
});
