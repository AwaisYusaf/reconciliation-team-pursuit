/**
 * Internal links and the outline for the finished packet (R10.5a, D-83).
 *
 * pdf-lib has no high-level API for either, so this is the one place the raw `/Annots` and
 * `/Outlines` objects are written and read. Two facts, established by probing this exact
 * library version before the design was chosen, shape everything here:
 *
 * - A link and an outline survive `PDFDocument.load` → draw → `save`, which is what the footer
 *   stamp does. So they can be added before stamping and reach the delivered bytes.
 * - Neither survives `copyPages`: the copied page carries its annotation, but the destination
 *   still points at a page of the *source* document, and the catalog's outline is not copied at
 *   all. So nothing here may run on a section before it is merged — only on the final document.
 *   `pdf-links.test.ts` keeps a test that proves the second point, so the constraint stays
 *   visible to whoever next touches assembly.
 *
 * Coordinates are PDF points with the origin at the bottom-left, as pdf-lib draws them. The
 * flip from the top-origin measurements `pdftotext` reports happens in the module that locates
 * anchors, in exactly one place — never here.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRef,
  PDFString,
} from "pdf-lib";

/** A rectangle in PDF points, bottom-left origin. */
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Where a link lands: a page, and optionally the y (from the bottom) to scroll to the top of
 * the viewport, so a heading arrives at the top of the window rather than the page merely
 * opening.
 */
export type Target = { page: PDFPage; top?: number };

function destination(doc: PDFDocument, target: Target): PDFArray {
  // `/XYZ left top zoom` with nulls keeps the viewer's current horizontal position and zoom.
  // Without a `top`, `/Fit` shows the whole page.
  return target.top === undefined
    ? doc.context.obj([target.page.ref, PDFName.of("Fit")])
    : doc.context.obj([target.page.ref, PDFName.of("XYZ"), null, target.top, null]);
}

/**
 * Add an invisible clickable rectangle on `page` that jumps to `target`.
 *
 * `/Border [0 0 0]` is what keeps it invisible — the printed page and the rendered page are
 * unchanged, which R10.5a requires. The rectangle is stored exactly as given, so a test can
 * check it sits over the text it stands for.
 */
export function addInternalLink(doc: PDFDocument, page: PDFPage, rect: Rect, target: Target): void {
  const annotation = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    Border: [0, 0, 0],
    Dest: destination(doc, target),
  });
  const ref = doc.context.register(annotation);

  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing instanceof PDFArray) existing.push(ref);
  else page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
}

/** One bookmark; `children` nest beneath it in the sidebar. */
export type OutlineItem = { title: string; target: Target; children?: OutlineItem[] };

/**
 * Write the outline (bookmark sidebar). Replaces any existing outline.
 *
 * Titles are written as UTF-16 text strings: a plain literal string reads back blank in
 * poppler, which is how the probe first found this out.
 */
export function addOutline(doc: PDFDocument, items: OutlineItem[]): void {
  if (items.length === 0) return;
  const ctx = doc.context;
  const rootRef = ctx.nextRef();

  // Returns the refs of the nodes written at this level, so a parent can point at first/last.
  function write(level: OutlineItem[], parentRef: PDFRef): { first: PDFRef; last: PDFRef; count: number } {
    const refs = level.map(() => ctx.nextRef());
    let count = 0;
    level.forEach((item, index) => {
      const entries: Record<string, PDFRef | PDFHexString | PDFArray | number> = {
        Title: PDFHexString.fromText(item.title),
        Parent: parentRef,
        Dest: destination(doc, item.target),
      };
      if (index > 0) entries.Prev = refs[index - 1];
      if (index < refs.length - 1) entries.Next = refs[index + 1];
      count += 1;
      if (item.children && item.children.length > 0) {
        const nested = write(item.children, refs[index]);
        entries.First = nested.first;
        entries.Last = nested.last;
        // Positive: children shown open. The sidebar is more useful expanded to the expenses.
        entries.Count = nested.count;
        count += nested.count;
      }
      ctx.assign(refs[index], ctx.obj(entries));
    });
    return { first: refs[0], last: refs[refs.length - 1], count };
  }

  const top = write(items, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: "Outlines", First: top.first, Last: top.last, Count: top.count }));
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
}

/* ------------------------------------------------------------ read-back */

export type ReadLink = {
  /** 0-based page index the link sits on. */
  fromPage: number;
  rect: Rect;
  /** 0-based page index it jumps to, or -1 if the destination page is not in this document. */
  toPage: number;
  top: number | null;
};

function pageIndexOf(pages: PDFPage[], ref: unknown): number {
  if (!(ref instanceof PDFRef)) return -1;
  return pages.findIndex((page) => page.ref === ref || page.ref.objectNumber === ref.objectNumber);
}

function destinationOf(pages: PDFPage[], dest: unknown): { toPage: number; top: number | null } {
  if (!(dest instanceof PDFArray)) return { toPage: -1, top: null };
  const toPage = pageIndexOf(pages, dest.get(0));
  const third = dest.size() > 3 ? dest.get(3) : undefined;
  return { toPage, top: third instanceof PDFNumber ? third.asNumber() : null };
}

/**
 * Every internal link in a document, resolved to page indices. Used by tests against the
 * delivered bytes, which is the only thing worth asserting on.
 */
export async function readLinks(bytes: Uint8Array): Promise<ReadLink[]> {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const links: ReadLink[] = [];

  pages.forEach((page, fromPage) => {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) return;
    for (let index = 0; index < annots.size(); index += 1) {
      const annot = annots.lookup(index, PDFDict);
      if (annot.lookup(PDFName.of("Subtype")) !== PDFName.of("Link")) continue;
      const rect = annot.lookup(PDFName.of("Rect"), PDFArray);
      const [x0, y0, x1, y1] = [0, 1, 2, 3].map((i) => rect.lookup(i, PDFNumber).asNumber());
      links.push({
        fromPage,
        rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
        ...destinationOf(pages, annot.lookup(PDFName.of("Dest"))),
      });
    }
  });
  return links;
}

export type ReadOutlineItem = { title: string; toPage: number; depth: number };

/** The outline flattened in sidebar order, with nesting depth. */
export async function readOutline(bytes: Uint8Array): Promise<ReadOutlineItem[]> {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const root = doc.catalog.lookup(PDFName.of("Outlines"));
  if (!(root instanceof PDFDict)) return [];

  const out: ReadOutlineItem[] = [];
  function walk(first: unknown, depth: number) {
    let node = first;
    while (node instanceof PDFDict) {
      const title = node.lookup(PDFName.of("Title"));
      const text =
        title instanceof PDFHexString || title instanceof PDFString ? title.decodeText() : "";
      out.push({ title: text, toPage: destinationOf(pages, node.lookup(PDFName.of("Dest"))).toPage, depth });
      walk(node.lookup(PDFName.of("First")), depth + 1);
      node = node.lookup(PDFName.of("Next"));
    }
  }
  walk(root.lookup(PDFName.of("First")), 0);
  return out;
}
