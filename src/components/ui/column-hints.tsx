import { UI } from "@/src/domain/strings";

/**
 * "What do these columns mean?" under a funder-form table (Line Items, Contract Summary;
 * usability #39, #47). Closed by default so the page still reads as the form; open, each column
 * name sits beside its meaning in one small card. The native `<details>` does the opening.
 */
export function ColumnHints({ items }: { items: readonly { term: string; text: string }[] }) {
  return (
    <details className="group mt-4 max-w-[640px]">
      <summary className="cursor-pointer w-fit text-[15px] text-accent underline hover:text-accent-dark">
        {UI.columnsHelp}
      </summary>
      <dl className="mt-2.5 rounded-[3px] border border-line bg-surface divide-y divide-line">
        {items.map((item) => (
          <div key={item.term} className="grid grid-cols-[minmax(120px,160px)_1fr] gap-4 px-4 py-2.5 text-[15px]">
            <dt className="font-semibold text-ink">{item.term}</dt>
            <dd className="text-sub">{item.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
