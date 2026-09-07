/**
 * Internal links and the outline (R10.5a, D-83).
 *
 * These reproduce the probes the design rests on. The `copyPages` test is the important one:
 * it must keep failing the way it does today, because the day it passes is the day someone can
 * move the link pass upstream of assembly and silently break every destination.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { addInternalLink, addOutline, readLinks, readOutline } from "./pdf-links";

async function threePages() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [1, 2, 3].map((n) => {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${n}`, { x: 72, y: 720, font, size: 14 });
    return page;
  });
  return { doc, pages };
}

/** What `stampFooters` does: load the bytes, draw on every page, save the same document. */
async function stamp(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.getPages().forEach((page, index) =>
    page.drawText(`footer ${index + 1}`, { x: 250, y: 25, font, size: 9, color: rgb(0.47, 0.47, 0.47) }),
  );
  return doc.save();
}

function hasPdftohtml(): boolean {
  const probe = spawnSync("pdftohtml", ["-v"], { encoding: "utf8" });
  return !probe.error && /pdftohtml version/i.test(`${probe.stdout ?? ""}${probe.stderr ?? ""}`);
}

describe("addInternalLink", () => {
  it("jumps to the page and position it was given, with no visible border", async () => {
    const { doc, pages } = await threePages();
    addInternalLink(doc, pages[0], { x: 72, y: 600, width: 128, height: 20 }, { page: pages[2], top: 700 });

    const [link] = await readLinks(await doc.save());
    expect(link).toEqual({ fromPage: 0, rect: { x: 72, y: 600, width: 128, height: 20 }, toPage: 2, top: 700 });
  });

  it("survives the footer stamp — load, draw on every page, save", async () => {
    const { doc, pages } = await threePages();
    addInternalLink(doc, pages[0], { x: 72, y: 600, width: 128, height: 20 }, { page: pages[2], top: 700 });

    const [link] = await readLinks(await stamp(await doc.save()));
    expect(link.toPage).toBe(2);
    expect(link.top).toBe(700);
  });

  it("does NOT survive copyPages — which is why links go on the finished document only", async () => {
    const { doc, pages } = await threePages();
    addInternalLink(doc, pages[0], { x: 72, y: 600, width: 128, height: 20 }, { page: pages[2] });

    const source = await PDFDocument.load(await doc.save());
    const merged = await PDFDocument.create();
    for (const page of await merged.copyPages(source, source.getPageIndices())) merged.addPage(page);

    const [link] = await readLinks(await merged.save());
    // The annotation was copied; its destination still names a page of the source document.
    expect(link.fromPage).toBe(0);
    expect(link.toPage).toBe(-1);
  });

  it("adds to an existing Annots array rather than replacing it", async () => {
    const { doc, pages } = await threePages();
    addInternalLink(doc, pages[0], { x: 0, y: 0, width: 10, height: 10 }, { page: pages[1] });
    addInternalLink(doc, pages[0], { x: 0, y: 20, width: 10, height: 10 }, { page: pages[2] });

    const links = await readLinks(await doc.save());
    expect(links.map((link) => link.toPage)).toEqual([1, 2]);
  });
});

describe("addOutline", () => {
  it("nests items and resolves every destination", async () => {
    const { doc, pages } = await threePages();
    addOutline(doc, [
      { title: "Summary", target: { page: pages[0] } },
      {
        title: "Salary",
        target: { page: pages[1] },
        children: [{ title: "2026-02-014 — Jordan Ellis", target: { page: pages[2], top: 700 } }],
      },
    ]);

    expect(await readOutline(await doc.save())).toEqual([
      { title: "Summary", toPage: 0, depth: 0 },
      { title: "Salary", toPage: 1, depth: 0 },
      { title: "2026-02-014 — Jordan Ellis", toPage: 2, depth: 1 },
    ]);
  });

  it("survives the footer stamp", async () => {
    const { doc, pages } = await threePages();
    addOutline(doc, [{ title: "Summary", target: { page: pages[0] } }]);
    expect(await readOutline(await stamp(await doc.save()))).toHaveLength(1);
  });

  it.skipIf(!hasPdftohtml())("is readable by a second reader, not only by pdf-lib", async () => {
    // Titles written as plain strings read back blank in poppler; this guards the encoding.
    const { doc, pages } = await threePages();
    addOutline(doc, [{ title: "Salary — 2026-02-014", target: { page: pages[1] } }]);
    const dir = mkdtempSync(path.join(tmpdir(), "ngo-outline-"));
    try {
      const file = path.join(dir, "outline.pdf");
      writeFileSync(file, await doc.save());
      const xml = execFileSync("pdftohtml", ["-xml", "-stdout", "-i", file], { encoding: "utf8" });
      expect(xml).toContain("Salary — 2026-02-014");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
