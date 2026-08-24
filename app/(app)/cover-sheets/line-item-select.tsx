"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Select } from "@/src/components/ui/select";

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
    <div className="flex flex-col gap-1.5">
      <label id="line-item-select-label" htmlFor="line-item-select" className="text-[13px] font-medium text-muted">
        Line item
      </label>
      <Select
        id="line-item-select"
        aria-labelledby="line-item-select-label"
        value={selected}
        disabled={pending}
        onValueChange={(value) => {
          startTransition(() => {
            router.push(`/cover-sheets?lineItem=${encodeURIComponent(value)}`);
          });
        }}
        className="min-w-[220px]"
      >
        <option value={ALL_LINE_ITEMS}>All Line Items</option>
        {lineItems.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
