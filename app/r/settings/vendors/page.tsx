import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/src/components/ui/surfaces";
import { pageTitle } from "@/src/domain/strings";
import { loadVendorsPage, VENDORS_PAGE_SIZE } from "@/src/modules/settings/queries";
import { pageSession } from "@/src/lib/page-session";

import { VendorLibraryFull } from "./vendor-library-full";

export const metadata = { title: pageTitle("Vendor library") };

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const session = await pageSession();

  const { q, page: pageParam } = await searchParams;
  const query = q ?? "";
  // A non-numeric or negative page (edited by hand in the URL) falls back to page 1 rather
  // than erroring or querying with a nonsensical offset.
  const requestedPage = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const data = await loadVendorsPage(session.orgId, { query, page: requestedPage });

  // The high end of the range needs the total to check against, which isn't known until
  // after the query runs — e.g. deleting the only vendor on page 2 leaves that page's own
  // "page=2" URL pointing past the new last page. Redirect to the real last page rather than
  // rendering a self-contradicting "21-20 of 20" with an empty table underneath it.
  const lastPage = Math.max(1, Math.ceil(data.total / VENDORS_PAGE_SIZE));
  if (requestedPage > lastPage) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("page", String(lastPage));
    redirect(`/r/settings/vendors?${params.toString()}`);
  }
  const page = requestedPage;

  return (
    <div>
      <PageHeader
        title="Vendor library"
        subtext="Every vendor the library has learned from a saved expense."
        actions={
          <Link href="/r/settings" className="text-[15px] text-accent underline hover:text-accent-dark">
            Back to Settings
          </Link>
        }
      />

      <VendorLibraryFull
        vendors={data.vendors}
        total={data.total}
        page={page}
        pageSize={VENDORS_PAGE_SIZE}
        query={query}
        lineItems={data.lineItems}
        paymentSources={data.paymentSources.map((row) => ({
          id: row.id,
          label: row.label,
          active: row.active,
        }))}
      />
    </div>
  );
}
