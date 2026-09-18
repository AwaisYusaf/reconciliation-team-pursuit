/**
 * Copy text (Phase 11 §7.3, P6). Pure — the browser clipboard objects are passed in, so this
 * can be unit-tested in a node vitest environment with fakes.
 */
import { toHtml, toPlainText } from "@/src/domain/summary-markdown";

export type ClipboardLike = {
  write?: (items: unknown[]) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
};

/**
 * `write([item])` with both `text/html` (escaped, from the P6 parser) and `text/plain`; falls
 * back to `writeText` of the plain text when `write`/`ClipboardItem` is missing or throws;
 * "refused" when neither works.
 */
export async function copySummary(
  markdown: string,
  clipboard: ClipboardLike | undefined,
  makeItem?: (parts: Record<string, Blob>) => unknown,
): Promise<"copied" | "refused"> {
  const plain = toPlainText(markdown);

  if (clipboard?.write && makeItem) {
    try {
      const item = makeItem({
        "text/html": new Blob([toHtml(markdown)], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      });
      await clipboard.write([item]);
      return "copied";
    } catch {
      // Fall through to the plain-text fallback.
    }
  }

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(plain);
      return "copied";
    } catch {
      return "refused";
    }
  }

  return "refused";
}
