import Link from "next/link";

/** Root 404, for paths outside the authenticated shell. */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-6">
      <div className="max-w-[440px] text-center">
        <h1 className="font-serif text-[28px] font-bold text-ink mb-3">Not found</h1>
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
