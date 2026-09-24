import Link from "next/link";

import { DangerPanel } from "@/src/components/ui/surfaces";
import { cn } from "@/src/lib/cn";

/**
 * Only what this panel renders, rather than the gate's full `BlockingRecord`.
 *
 * The two callers pass different shapes — the cover sheet hands over `BlockingRecord` from
 * `blockingRecords`, the packet a narrower row from its readiness query — and both already
 * carry the label, pre-joined in the wording R4.4 defines. Asking for the whole record would
 * force one of them to widen its query for a field nothing here reads.
 */
export type BlockingListItem = {
  expenseId: string;
  /** `{name} · {line item} · {what is missing}`, built by `blockingLabel` (R4.4). */
  label: string;
};

/** How many records are listed before the rest go behind "Show the other N". */
const SHOWN = 6;

/**
 * Two columns only once there are enough records to fill them. Splitting three records across
 * two columns leaves a half-empty second one, which reads as a mistake rather than as a list.
 */
function RecordList({ records }: { records: readonly BlockingListItem[] }) {
  return (
    <ul
      className={cn("mt-3 m-0 p-0 list-none grid gap-x-10", records.length > 5 && "xl:grid-cols-2")}
    >
      {records.map((record) => (
        <li
          key={record.expenseId}
          className="flex items-baseline justify-between gap-4 py-2 border-b border-danger/20 last:border-b-0"
        >
          <span className="min-w-0">{record.label}</span>
          {/* R4.4: each record links straight to the expense that needs fixing. */}
          <Link
            href={`/r/expenses/${record.expenseId}/edit`}
            className="shrink-0 underline text-danger font-medium whitespace-nowrap"
          >
            Open expense
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The "this cannot be downloaded yet" panel, with the records that are holding it up.
 *
 * One component for the packet and for a cover sheet: the two screens showed the same list in
 * the same words and had drifted to two copies of the markup, which is how the packet's
 * version ended up with a different bottom margin from the cover sheet's.
 *
 * Each record is a ruled row with its link pinned to the right, rather than the label and the
 * link running together as one wrapping sentence. A month with fourteen incomplete expenses
 * first rendered as fourteen stacked lines down the left third of the screen, then, laid into
 * columns, as ragged blocks where "Open expense" fell onto its own line under some records and
 * not others. A row with a fixed left and right edge is the same shape whatever the name's
 * length, so the column of links stays a column and the list can be scanned down rather than
 * read across.
 */
export function BlockingPanel({
  title,
  intro,
  records,
  className,
  "data-tour": dataTour,
}: {
  title: string;
  intro: string;
  records: readonly BlockingListItem[];
  className?: string;
  "data-tour"?: string;
}) {
  return (
    // The tour anchor sits on the wrapper so the spotlight lights the panel's own box.
    <div data-tour={dataTour} className={cn("mb-7", className)}>
      <DangerPanel title={title}>
        <p className="mt-1.5 mb-0">{intro}</p>
        <RecordList records={records.slice(0, SHOWN)} />

        {/*
          The rest behind a disclosure, and a `<details>` rather than client state.

          A month early in its life can have every expense incomplete, and the full list then
          ran past the fold and pushed the readiness table off the screen — at the moment
          someone is trying to judge how much is left to do. The first few say what kind of
          problem it is; the count says how big.

          `<details>` keeps this a server component and works with JavaScript disabled, which a
          hand-rolled toggle would not.
        */}
        {records.length > SHOWN && (
          <details className="group mt-1">
            <summary className="cursor-pointer list-none underline text-danger font-medium py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger rounded-[3px]">
              <span className="group-open:hidden">
                Show the other {records.length - SHOWN}
              </span>
              <span className="hidden group-open:inline">Show fewer</span>
            </summary>
            <RecordList records={records.slice(SHOWN)} />
          </details>
        )}
      </DangerPanel>
    </div>
  );
}
