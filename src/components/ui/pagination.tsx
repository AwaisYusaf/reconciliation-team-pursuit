import Link from "next/link";

import { ButtonLabel, buttonClassName } from "@/src/components/ui/button";
import { UI } from "@/src/domain/strings";

/**
 * "Page N of M" with Previous and Next, under a list paged in the database (D-102). Nothing at
 * all on a single page. Moved out of the `/a` organizations list so the feature requests list
 * pages the same way (PHASE-17, ticket §6); `hrefFor` builds each page's link with the list's
 * own filters kept.
 */
export function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label={UI.pagesLabel} className="mt-5 flex items-center justify-between gap-4 flex-wrap">
      <div className="text-[15px] text-sub">{UI.pageOf(page, pageCount)}</div>
      <div className="flex items-center gap-2">
        <PageLink label={UI.pagePrevious} href={page > 1 ? hrefFor(page - 1) : null} />
        <PageLink label={UI.pageNext} href={page < pageCount ? hrefFor(page + 1) : null} />
      </div>
    </nav>
  );
}

function PageLink({ label, href }: { label: string; href: string | null }) {
  if (!href) {
    return (
      <span aria-disabled="true" className={buttonClassName("secondary", "min-h-11 px-4 text-[15px] opacity-50")}>
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className={buttonClassName("secondary", "min-h-11 px-4 text-[15px] no-underline")}>
      <ButtonLabel>{label}</ButtonLabel>
    </Link>
  );
}
