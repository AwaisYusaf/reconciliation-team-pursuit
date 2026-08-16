import { describe, expect, it } from "vitest";

import { attachmentHeader } from "./http";

describe("attachmentHeader", () => {
  it("sends both the quoted name and the encoded one", () => {
    expect(attachmentHeader("Team_Pursuit_February_2026_Summary.xlsx")).toBe(
      'attachment; filename="Team_Pursuit_February_2026_Summary.xlsx"; ' +
        "filename*=UTF-8''Team_Pursuit_February_2026_Summary.xlsx",
    );
  });

  it("cannot be used to terminate the quoted string", () => {
    // An uploaded file may be named anything at all, including this.
    const header = attachmentHeader('evil".pdf');
    expect(header).toContain('filename="evil.pdf"');
    // Exactly one quoted section, so nothing escaped into a second parameter.
    expect(header.match(/filename="/g)).toHaveLength(1);
  });

  it("cannot be used to inject a second header", () => {
    const header = attachmentHeader("a.pdf\r\nSet-Cookie: session=stolen");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
    // The encoded form escapes the newlines rather than dropping them.
    expect(header).toContain("%0D%0A");
  });

  it("strips backslashes, which would otherwise escape the closing quote", () => {
    expect(attachmentHeader('a\\".pdf')).toContain('filename="a.pdf"');
  });

  it("keeps a non-ASCII name intact in the encoded form", () => {
    const header = attachmentHeader("Reçu février.pdf");
    expect(header).toContain("filename*=UTF-8''Re%C3%A7u%20f%C3%A9vrier.pdf");
    // The ASCII fallback drops the accents rather than mangling them.
    expect(header).toContain('filename="Reu fvrier.pdf"');
  });

  it("falls back to a usable name when nothing survives sanitising", () => {
    expect(attachmentHeader("Ω")).toContain('filename="download"');
  });

  it("percent-encodes the apostrophe, which delimits the RFC 8187 ext-value", () => {
    const header = attachmentHeader("Bob's receipt.pdf");
    expect(header).toContain("filename*=UTF-8''Bob%27s%20receipt.pdf");

    // An apostrophe is legal inside the quoted fallback, but in the ext-value it delimits
    // charset from language from value — so past the two delimiters there must be none.
    const extValue = header.slice(header.indexOf("filename*=UTF-8''") + "filename*=UTF-8''".length);
    expect(extValue).not.toContain("'");
  });

  it("escapes the other characters encodeURIComponent leaves alone", () => {
    const header = attachmentHeader("a(1)*!.pdf");
    expect(header).toContain("filename*=UTF-8''a%281%29%2A%21.pdf");
  });

  it("bounds the length, so the header cannot exceed what a proxy will accept", () => {
    const header = attachmentHeader(`${"a".repeat(5000)}.pdf`);
    expect(header.length).toBeLessThan(400);
  });
});
