/**
 * The generated documents' palette is the app's own (D-137), and the on-screen cover sheet
 * preview draws from the same supplier as the Word file.
 *
 * Both halves are "two paths that must agree": the tokens live in CSS, which Word and pdf-lib
 * cannot read, so `document-theme.ts` repeats them; and the preview is React, which the Word
 * builder cannot share code with. This repo runs no component tests (`vitest.config.mts` is
 * node-only), so the preview is checked by reading its source, as the tour wiring test does.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DOCUMENT_THEME, channels } from "./document-theme";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("document theme", () => {
  it("repeats the app's design tokens exactly", () => {
    const css = readFileSync(`${repoRoot}app/globals.css`, "utf8");
    const token = (name: string) =>
      css.match(new RegExp(`--color-${name}:\\s*#([0-9a-fA-F]{6});`))?.[1]?.toUpperCase();
    expect(DOCUMENT_THEME).toEqual({
      ink: token("ink"),
      sub: token("sub"),
      line: token("line"),
      accent: token("accent"),
      onAccent: token("surface"),
      section: token("section"),
    });
  });

  it("converts hex to pdf-lib's 0 to 1 channels", () => {
    expect(channels("5B3A29")).toEqual([0x5b / 255, 0x3a / 255, 0x29 / 255]);
    expect(channels("FFFFFF")).toEqual([1, 1, 1]);
  });
});

describe("cover sheet preview", () => {
  const source = readFileSync(`${repoRoot}app/r/cover-sheets/cover-sheet-preview.tsx`, "utf8");

  it("reads the Word file's palette and column shares rather than its own copies", () => {
    expect(source).toContain('from "@/src/generation/document-theme"');
    expect(source).toContain("COVER_COLUMN_SHARES[index]");
  });

  it("hardcodes no colour of its own", () => {
    // No yellow left behind, and no literal colour class a later edit could drift from.
    expect(source).not.toMatch(/ffff00/i);
    expect(source).not.toMatch(/(?:bg|border|text)-\[#/);
    expect(source).not.toMatch(/["'`]#[0-9a-f]{3,8}["'`]/i);
    expect(source).not.toContain("border-black");
  });
});
