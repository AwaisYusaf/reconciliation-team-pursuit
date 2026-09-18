import { SparkleIcon } from "@/src/components/ui/plus-badge";
import { UI } from "@/src/domain/strings";

/**
 * Shown in place of the summary while the model is writing (user feedback 2026-09-18: the old
 * draft stayed on screen during a rewrite, so nothing said the page was busy).
 *
 * Shaped like the summary it is replacing — a heading, a paragraph, some bullets — so the card
 * doesn't jump when the real text arrives. The shimmer is `motion-safe` only: with reduced motion
 * it is a plain grey block, and the message below is what carries the meaning either way.
 */
const LINES = [
  { w: "w-1/3", heading: true },
  { w: "w-full" },
  { w: "w-11/12" },
  { w: "w-2/3" },
  { w: "w-1/4", heading: true },
  { w: "w-10/12" },
  { w: "w-9/12" },
  { w: "w-11/12" },
  { w: "w-1/3", heading: true },
  { w: "w-10/12" },
  { w: "w-8/12" },
];

export function SummarySkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="border border-line rounded-[3px] bg-surface px-4 py-4 lg:min-h-[480px]"
    >
      <div className="flex items-center gap-2 text-[15px] text-accent font-semibold mb-4">
        <SparkleIcon className="motion-safe:animate-pulse" />
        {UI.summaryWriting}
      </div>
      <div className="flex flex-col gap-3" aria-hidden="true">
        {LINES.map((line, index) => (
          <div
            key={index}
            className={`${line.heading ? "h-4 mt-2" : "h-3"} ${line.w} rounded-full bg-section motion-safe:animate-pulse`}
            style={{ animationDelay: `${index * 90}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
