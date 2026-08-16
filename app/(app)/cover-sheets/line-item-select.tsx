"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ALL_LINE_ITEMS } from "./constants";

/**
 * Which line item's sheet to preview.
 *
 * The choice lives in the URL rather than in component state so the view is shareable and
 * survives a refresh — and so the page itself stays a server component that reads the
 * selection straight from `searchParams`.
 */
export function LineItemSelect({
  lineItems,
  selected,
}: {
  lineItems: readonly { id: string; name: string }[];
  selected: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-muted">Line item</span>
      <select
        value={selected}
        disabled={pending}
        onChange={(event) => {
          const value = event.target.value;
          startTransition(() => {
            router.push(`/cover-sheets?lineItem=${encodeURIComponent(value)}`);
          });
        }}
        className="border border-line rounded-md px-3 py-2 text-[15px] bg-white min-w-[220px] disabled:opacity-60"
      >
        <option value={ALL_LINE_ITEMS}>All Line Items</option>
        {lineItems.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}
