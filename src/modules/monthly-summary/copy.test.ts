/**
 * `copySummary` (Phase 11 §7.3, P6). Fakes for the clipboard objects — no real browser
 * clipboard in a node vitest environment.
 */
import { describe, expect, it, vi } from "vitest";

import { copySummary, type ClipboardLike } from "./copy";

const MARKDOWN = "## Heading\n\n<script>alert(1)</script>\n\n- one\n- two";

async function blobText(blob: Blob): Promise<string> {
  return blob.text();
}

describe("write path (rich clipboard)", () => {
  it("writes both text/html and text/plain with correct, escaped contents", async () => {
    const write = vi.fn<(items: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const clipboard: ClipboardLike = { write };
    const makeItem = vi.fn((parts: Record<string, Blob>) => parts);

    const outcome = await copySummary(MARKDOWN, clipboard, makeItem);
    expect(outcome).toBe("copied");
    expect(makeItem).toHaveBeenCalledTimes(1);

    const parts = makeItem.mock.calls[0][0];
    expect(Object.keys(parts).sort()).toEqual(["text/html", "text/plain"]);
    const html = await blobText(parts["text/html"]);
    const plain = await blobText(parts["text/plain"]);

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");

    expect(plain).toBe("Heading\n\n<script>alert(1)</script>\n\n• one\n• two");

    expect(write).toHaveBeenCalledWith([parts]);
  });
});

describe("fallback to writeText", () => {
  it("falls back when write is missing", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const clipboard: ClipboardLike = { writeText };
    const outcome = await copySummary(MARKDOWN, clipboard);
    expect(outcome).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("Heading\n\n<script>alert(1)</script>\n\n• one\n• two");
  });

  it("falls back when makeItem is missing even though write exists", async () => {
    const write = vi.fn<(items: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const clipboard: ClipboardLike = { write, writeText };
    const outcome = await copySummary(MARKDOWN, clipboard); // no makeItem passed
    expect(outcome).toBe("copied");
    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("falls back when write throws", async () => {
    const write = vi.fn<(items: unknown[]) => Promise<void>>().mockRejectedValue(new Error("denied"));
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const clipboard: ClipboardLike = { write, writeText };
    const makeItem = (parts: Record<string, Blob>) => parts;
    const outcome = await copySummary(MARKDOWN, clipboard, makeItem);
    expect(outcome).toBe("copied");
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

describe("refused", () => {
  it("both write and writeText missing → refused", async () => {
    const outcome = await copySummary(MARKDOWN, {});
    expect(outcome).toBe("refused");
  });

  it("clipboard undefined entirely → refused", async () => {
    const outcome = await copySummary(MARKDOWN, undefined);
    expect(outcome).toBe("refused");
  });

  it("write throws and writeText also throws → refused", async () => {
    const write = vi.fn<(items: unknown[]) => Promise<void>>().mockRejectedValue(new Error("denied"));
    const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error("denied too"));
    const clipboard: ClipboardLike = { write, writeText };
    const makeItem = (parts: Record<string, Blob>) => parts;
    const outcome = await copySummary(MARKDOWN, clipboard, makeItem);
    expect(outcome).toBe("refused");
  });

  it("writeText missing (write also missing) → refused, no throw", async () => {
    const clipboard: ClipboardLike = {};
    const outcome = await copySummary(MARKDOWN, clipboard);
    expect(outcome).toBe("refused");
  });

  it("writeText throws when it's the only option → refused", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error("nope"));
    const outcome = await copySummary(MARKDOWN, { writeText });
    expect(outcome).toBe("refused");
  });
});

describe("edge input", () => {
  it("empty markdown still copies (empty plain text)", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const outcome = await copySummary("", { writeText });
    expect(outcome).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("");
  });
});
