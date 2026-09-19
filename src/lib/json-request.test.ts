/** `readCappedText`: the cap holds whatever `Content-Length` claims (PHASE-12 review). */
import { describe, expect, it } from "vitest";

import { readCappedText } from "./json-request";

function streamed(text: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/x", {
    method: "POST",
    body: new Blob([text]).stream(),
    headers,
    duplex: "half",
  } as RequestInit);
}

describe("readCappedText", () => {
  it("reads a body within the cap", async () => {
    expect(await readCappedText(streamed("hello"), 10)).toBe("hello");
  });

  it("stops at the cap when no length is declared", async () => {
    expect(await readCappedText(streamed("x".repeat(11)), 10)).toBeNull();
  });

  it("stops at the cap when the declared length is a lie", async () => {
    expect(await readCappedText(streamed("x".repeat(5_000), { "content-length": "3" }), 10)).toBeNull();
  });

  it("refuses an honest oversized request before reading it", async () => {
    expect(await readCappedText(streamed("x", { "content-length": "11" }), 10)).toBeNull();
  });
});
