import Link from "next/link";
import { PageTitle } from "@/src/components/ui/surfaces";

/** Root 404, for paths outside the authenticated shell. */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-6">
      <div className="max-w-[440px] text-center">
        <PageTitle className="mb-3">Not found</PageTitle>
        <p className="text-[15px] text-sub leading-relaxed mb-6">
          That page does not exist.
        </p>
        <Link href="/" className="text-accent underline hover:text-accent-dark text-[15px]">
          Go to Grant Expense Reconciliation
        </Link>
      </div>
    </div>
  );
}
