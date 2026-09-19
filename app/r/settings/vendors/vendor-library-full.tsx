"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Input, Label } from "@/src/components/ui/field";
import { reportResult } from "@/src/components/ui/toast";
import type { ActionResult } from "@/src/lib/action-result";

import { VendorTable, type LabelRow, type Vendor } from "../vendor-table";

/**
 * The full, searchable, paginated vendor library. Search and page live in the URL (`?q=` /
 * `?page=`) rather than component state, so the page is a server component that re-queries on
 * every change — the same reason `cover-sheets` keeps its selection in the URL — and a link
 * to a specific search+page is shareable and survives a refresh.
 */
export function VendorLibraryFull({
  vendors,
  total,
  page,
  pageSize,
  query,
  lineItems,
  paymentSources,
}: {
  vendors: Vendor[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  lineItems: Array<{ id: string; name: string }>;
  paymentSources: LabelRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced so every keystroke doesn't re-query the server; a fresh search always jumps
  // back to page 1, since a page number from the previous search means nothing for this one.
  useEffect(() => {
    if (search === query) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      router.push(`/r/settings/vendors?${params.toString()}`);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
    // `query` (the URL's current value) is read, not depended on — depending on it would
    // clear the timer set by this same keystroke the moment the URL updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function goToPage(next: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("page", String(next));
    router.push(`/r/settings/vendors?${params.toString()}`);
  }

  function run(work: () => Promise<ActionResult<unknown>>, successMessage: string) {
    startTransition(async () => {
      if (reportResult(await work(), successMessage)) router.refresh();
    });
  }

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <div>
      <div className="max-w-[360px] mb-5">
        <Label htmlFor="vendorSearch">Search vendors</Label>
        <Input
          id="vendorSearch"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <VendorTable
        vendors={vendors}
        lineItems={lineItems}
        paymentSources={paymentSources}
        pending={pending}
        run={run}
        emptyMessage={
          query
            ? `No vendors match "${query}".`
            : "No vendors learned yet. They appear as you save expenses."
        }
      />

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <div className="text-sm text-sub">
            {firstRow} to {lastRow} of {total}
          </div>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="min-h-11 px-4 text-[15px]"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              Previous
            </Button>
            <div className="flex items-center text-[15px] text-sub px-1">
              Page {page} of {lastPage}
            </div>
            <Button
              variant="secondary"
              className="min-h-11 px-4 text-[15px]"
              disabled={page >= lastPage}
              onClick={() => goToPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
