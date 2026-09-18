/**
 * Golden assertions on the monthly summary docx (Phase 11 §7.4, U-22).
 *
 * Same approach as `cover-sheet-docx.test.ts`: read the WordprocessingML out of the package
 * rather than trusting "it builds without throwing".
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { buildMonthlySummaryDocx } from "./monthly-summary-docx";

const TITLE = "Team Pursuit March 2026 Monthly Summary";

async function zipOf(markdown: string, title = TITLE) {
  const buffer = await buildMonthlySummaryDocx({ title, markdown });
  return JSZip.loadAsync(buffer);
}

async function documentXml(markdown: string, title = TITLE): Promise<string> {
  const zip = await zipOf(markdown, title);
  return zip.file("word/document.xml")!.async("string");
}

describe("monthly summary docx package", () => {
  it("is a valid Office Open XML package with the title present", async () => {
    const buffer = await buildMonthlySummaryDocx({ title: TITLE, markdown: "## Overview\nHello." });
    expect(buffer.subarray(0, 2).toString()).toBe("PK");

    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("word/document.xml")).not.toBeNull();
    expect(zip.file("[Content_Types].xml")).not.toBeNull();

    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain(TITLE);
  });

  it("sets US Letter with the cover sheet's margins", async () => {
    const xml = await documentXml("## Overview\nHello.");
    expect(xml).toContain('w:w="12240"');
    expect(xml).toContain('w:h="15840"');
    // 1 inch on every side, as the cover sheet.
    const margin = /<w:pgMar [^>]*\/>/.exec(xml)?.[0] ?? "";
    for (const side of ["top", "bottom", "left", "right"]) expect(margin).toContain(`w:${side}="1440"`);
  });

  it("uses Calibri as the run font throughout (not the cover sheet's Aptos — see the FONT comment)", async () => {
    const xml = await documentXml("## Overview\nHello.");
    expect(xml).toContain('w:ascii="Calibri"');
    expect(xml).not.toContain('w:ascii="Aptos"');
  });

  it("states lineRule=auto in styles (LibreOffice line-clipping regression)", async () => {
    const zip = await zipOf("## Overview\nHello.");
    const styles = await zip.file("word/styles.xml")!.async("string");
    const spacings = styles.match(/<w:spacing[^/]*\/>/g) ?? [];
    expect(spacings.length).toBeGreaterThan(0);
    for (const spacing of spacings) {
      if (spacing.includes("w:line=")) expect(spacing).toContain('w:lineRule="auto"');
    }
  });
});

describe("headings", () => {
  it("maps #, ## and ### to Heading1/2/3 pStyle", async () => {
    const xml = await documentXml("# One\n\n## Two\n\n### Three\n\nParagraph.");
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading3"/>');
  });

  it("makes every heading run bold and black, overriding docx's blue heading default", async () => {
    const xml = await documentXml("## A heading");
    const start = xml.indexOf('<w:pStyle w:val="Heading2"/>');
    const paragraph = xml.slice(start, xml.indexOf("</w:p>", start));
    expect(paragraph).toContain("<w:b/>");
    expect(paragraph).toContain('w:val="000000"');
  });
});

describe("bullets", () => {
  it("gives every list item a numPr referencing one numbering id, and numbering.xml declares a bullet", async () => {
    const zip = await zipOf("- one\n- two\n- three");
    const xml = await zip.file("word/document.xml")!.async("string");
    const numbering = await zip.file("word/numbering.xml")!.async("string");

    expect(numbering).not.toBeNull();
    expect(numbering).toContain('w:val="bullet"');
    expect(numbering).toContain("•");

    const numIds = [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
    expect(numIds).toHaveLength(3);
    expect(new Set(numIds).size).toBe(1); // one bullet list = one numId

    for (const item of ["one", "two", "three"]) expect(xml).toContain(item);
  });

  it("one paragraph per bullet item — no nesting", async () => {
    const xml = await documentXml("- alpha\n- beta");
    const paragraphs = xml.match(/<w:p[ >]/g) ?? [];
    // title + 2 bullets = 3 paragraphs.
    expect(paragraphs).toHaveLength(3);
  });
});

describe("inline emphasis", () => {
  it("only the bold run carries <w:b/> and only the italic run carries <w:i/>", async () => {
    const xml = await documentXml("This is **boldword** and this is *italicword* text.");
    // Each run is <w:r>…<w:t …>text</w:t></w:r>; the title run is bold too, so look per run.
    const runOf = (text: string) =>
      [...xml.matchAll(/<w:r>[\s\S]*?<\/w:r>/g)].map((m) => m[0]).find((run) => run.includes(`>${text}<`)) ?? "";
    expect(runOf("boldword")).toContain("<w:b/>");
    expect(runOf("boldword")).not.toContain("<w:i/>");
    expect(runOf("italicword")).toContain("<w:i/>");
    expect(runOf("italicword")).not.toContain("<w:b/>");
    const plain = runOf(" and this is ");
    expect(plain).not.toBe("");
    expect(plain).not.toContain("<w:b/>");
    expect(plain).not.toContain("<w:i/>");
  });
});

describe("XML-illegal characters (pasted text)", () => {
  it("drops control characters and turns vertical tab/form feed into a space, so the XML stays valid", async () => {
    const xml = await documentXml("## Overview\nline\u000Bbreak\u000Cfeed bell\u0007 soh\u0001 end\uFFFE.", "Title\u0008");
    const illegal = [...xml].filter((c) => {
      const n = c.charCodeAt(0);
      return (n < 0x20 && n !== 0x09 && n !== 0x0a && n !== 0x0d) || n === 0xfffe || n === 0xffff;
    });
    expect(illegal).toEqual([]);
    expect(xml).toContain("line break feed bell soh end.");
    expect(xml).toContain(">Title<");
  });
});

describe("literal text — nothing the parser doesn't recognise becomes markup (P6)", () => {
  it("escapes a script tag as plain text with no hyperlink/table elements", async () => {
    const xml = await documentXml('<script>alert(1)</script>\n\n[link](http://x)\n\n| a | b |\n\n`code`');
    expect(xml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(xml).not.toContain("<w:hyperlink");
    expect(xml).not.toContain("<w:tbl>");
    expect(xml).toContain("[link](http://x)");
    expect(xml).toContain("| a | b |");
    expect(xml).toContain("`code`");
  });
});

describe("unicode and emoji", () => {
  it("preserves accented characters, curly quotes, em dash and emoji", async () => {
    const xml = await documentXml('Café “résumé” — 🎉 done.');
    expect(xml).toContain("Café");
    expect(xml).toContain("“résumé”");
    expect(xml).toContain("—");
    expect(xml).toContain("🎉");
  });
});
