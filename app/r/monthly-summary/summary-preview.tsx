"use client";

/**
 * The summary as it will read once it leaves the app (Phase 11, user feedback 2026-09-18: the
 * editor showed raw `## Overview` Markdown, which is not how anyone reviews a report).
 *
 * Rendered from the same parser the Word builder, the PDF and Copy text use, so what is on
 * screen and what downloads can't drift. Every piece of text goes through React as a text node,
 * never React's raw-HTML escape hatch, so a `<script>` someone types stays visible as characters
 * (P6). `screen.test.ts` greps this file for that escape hatch by name, which is why the name
 * isn't written here.
 */
import { UI } from "@/src/domain/strings";
import { parseSummaryMarkdown, type Inline } from "@/src/domain/summary-markdown";
import { revealDelays } from "@/src/modules/monthly-summary/reveal";

function Text({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((inline, index) => {
        const key = `${index}-${inline.text}`;
        if (inline.bold && inline.italic) {
          return (
            <strong key={key}>
              <em>{inline.text}</em>
            </strong>
          );
        }
        if (inline.bold) return <strong key={key}>{inline.text}</strong>;
        if (inline.italic) return <em key={key}>{inline.text}</em>;
        return <span key={key}>{inline.text}</span>;
      })}
    </>
  );
}

export function SummaryPreview({ markdown, reveal = false }: { markdown: string; reveal?: boolean }) {
  const blocks = parseSummaryMarkdown(markdown);
  const delays = revealDelays(blocks, reveal);
  const delayFor = (line: number) => delays[line];
  // Running line total per block, computed once. Recomputing it inside the map with a slice was
  // quadratic: a 12,000-block summary took ~280 ms of jank on the reader's machine.
  const linesBefore = blocks.reduce<number[]>((acc, _block, index) => {
    const earlier = index === 0 ? null : blocks[index - 1];
    const earlierLines = earlier === null ? 0 : earlier.type === "list" ? earlier.items.length : 1;
    acc.push(index === 0 ? 0 : acc[index - 1] + earlierLines);
    return acc;
  }, []);

  return (
    <div
      className={`border border-line rounded-[3px] bg-surface px-4 py-3.5 lg:min-h-[480px] max-h-[70vh] overflow-y-auto${
        reveal ? " summary-reveal" : ""
      }`}
    >
      {blocks.length === 0 && <p className="text-[15px] text-muted">{UI.summaryPreviewEmpty}</p>}
      {blocks.map((block, index) => {
        const key = `${index}-${block.type}`;
        const lineBefore = linesBefore[index];
        if (block.type === "heading") {
          // Level 2 is a section title; 1 and 3 are rarer and sit one step either side of it.
          const size = block.level === 1 ? "text-xl" : block.level === 2 ? "text-lg" : "text-base";
          return (
            <h3 key={key} data-reveal="" style={delayFor(lineBefore)} className={`font-serif font-bold text-ink ${size} mt-5 first:mt-0 mb-2`}>
              <Text inlines={block.inlines} />
            </h3>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={key} className="list-disc pl-5 my-2 flex flex-col gap-1.5 text-[15px] text-ink">
              {block.items.map((item, itemIndex) => (
                <li key={`${itemIndex}-${item[0]?.text ?? ""}`} data-reveal="" style={delayFor(lineBefore + itemIndex)} className="leading-relaxed">
                  <Text inlines={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={key} data-reveal="" style={delayFor(lineBefore)} className="text-[15px] text-ink leading-relaxed my-2">
            <Text inlines={block.inlines} />
          </p>
        );
      })}
    </div>
  );
}
