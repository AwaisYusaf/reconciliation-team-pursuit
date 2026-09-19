import Image from "next/image";

import { PageTitle } from "@/src/components/ui/surfaces";

/** The logo card every shared-link page sits in — the same card and logo as sign-in. */
export function ShareCard({ title, children }: { title?: string; children?: React.ReactNode }) {
  return (
    <div className="w-full max-w-[440px] bg-surface border border-line rounded-[4px] px-6 sm:px-8 pt-9 pb-8">
      <div className="flex justify-center">
        <Image
          src="/brand/stayfunded-logo.png"
          alt="Stay Funded 360"
          width={220}
          height={147}
          priority
          className="w-[180px] sm:w-[220px] h-auto"
        />
      </div>
      {title && <PageTitle className="leading-tight mt-2.5 mb-6 text-center">{title}</PageTitle>}
      {children}
    </div>
  );
}
