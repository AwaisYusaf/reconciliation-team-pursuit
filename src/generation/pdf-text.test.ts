/**
 * Standard PDF fonts encode WinAnsi only, and pdf-lib throws on anything outside it. A
 * single invisible character pasted into Settings — a non-breaking hyphen, a zero-width
 * space — would otherwise abort every packet build for that organisation permanently, with
 * an error pointing nowhere near the field that caused it.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { winAnsiSafe } from "./pdf-text";

/** The real check: pdf-lib must accept whatever comes out of the sanitiser. */
async function drawable(text: string): Promise<boolean> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  try {
    pdf.addPage([612, 792]).drawText(winAnsiSafe(text), { x: 10, y: 10, size: 9, font });
    await pdf.save();
    return true;
  } catch {
    return false;
  }
}

describe("winAnsiSafe", () => {
  it("leaves ordinary text untouched", () => {
    expect(winAnsiSafe("Team Pursuit — February 2026 — Page 1 of 85")).toBe(
      "Team Pursuit — February 2026 — Page 1 of 85",
    );
  });

  it("keeps the characters WinAnsi genuinely supports", () => {
    // Em dash, en dash, curly quotes, ellipsis, bullet and middle dot all survive.
    const text = "— – ‘x’ “y” … • · € £ é ñ ü";
    expect(winAnsiSafe(text)).toBe(text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"'));
  });

  it("replaces a non-breaking hyphen, which is invisible and would throw", () => {
    expect(winAnsiSafe("Team‑Pursuit")).toBe("Team-Pursuit");
  });

  it("drops zero-width characters entirely", () => {
    expect(winAnsiSafe("Team​Pursuit")).toBe("TeamPursuit");
    expect(winAnsiSafe("Team﻿Pursuit")).toBe("TeamPursuit");
    expect(winAnsiSafe("soft­hyphen")).toBe("softhyphen");
  });

  it("turns a non-breaking space into a normal one", () => {
    expect(winAnsiSafe("Team Pursuit")).toBe("Team Pursuit");
  });

  it("folds letters that have no WinAnsi form to their base letter", () => {
    expect(winAnsiSafe("Łódź")).toBe("Lódz");
  });

  it("falls back to a question mark rather than throwing", () => {
    expect(winAnsiSafe("会社")).toBe("??");
    expect(winAnsiSafe("🎉")).toBe("?");
  });

  it("never returns something pdf-lib refuses to draw", async () => {
    const hostile = [
      "Team Pursuit",
      "Team‑Pursuit Global",
      "Team​Pursuit",
      "Łódź Community Fund",
      "会社 — Detroit",
      "🎉 Party Supplies Ltd",
      "Ω Ω Ω",
      "‑​­﻿",
      "Café Ñandú — 2026",
    ];

    for (const text of hostile) {
      expect(await drawable(text)).toBe(true);
    }
  });

  it("handles an empty string", () => {
    expect(winAnsiSafe("")).toBe("");
  });
});
