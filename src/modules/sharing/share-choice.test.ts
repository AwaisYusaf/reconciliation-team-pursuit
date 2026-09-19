/** The share dialog's two decisions (`app/r/packet/share-choice.ts`, Appendix A §2). */
import { describe, expect, it } from "vitest";

import { initialShareKind, sharedLinkFor } from "@/app/r/packet/share-choice";

describe("initialShareKind", () => {
  it("opens on the first file not yet shared", () => {
    expect(initialShareKind([])).toBe("packet");
    expect(initialShareKind([{ kind: "packet" }])).toBe("summary");
    expect(initialShareKind([{ kind: "summary" }])).toBe("packet");
    expect(initialShareKind([{ kind: "packet" }, { kind: "summary" }])).toBe("packet");
  });
});

describe("sharedLinkFor", () => {
  it("picks the already-shared file's row, so the dialog shows it instead of the form", () => {
    const links = [{ kind: "packet" as const, id: "a" }];
    expect(sharedLinkFor("packet", links)?.id).toBe("a");
    expect(sharedLinkFor("summary", links)).toBeNull();
  });
});
