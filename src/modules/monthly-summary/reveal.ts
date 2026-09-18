import type { Block } from "@/src/domain/summary-markdown";

/**
 * One delay per rendered line, in order: headings, paragraphs and every individual bullet. A
 * bullet list is several lines, and revealing a whole list at once read as the summary appearing
 * all together (user feedback 2026-09-18). Computed here, outside the component, so the running
 * count is never mutated during render. Capped so a long summary's tail isn't left waiting.
 */
export function revealDelays(blocks: Block[], reveal: boolean): (React.CSSProperties | undefined)[] {
  if (!reveal) return [];
  const lines = blocks.reduce((count, block) => count + (block.type === "list" ? block.items.length : 1), 0);
  return Array.from({ length: lines }, (_unused, line) => ({
    animationDelay: `${Math.min(line * 150, 4000)}ms`,
  }));
}
