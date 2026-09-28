import Image from "next/image";
import Link from "next/link";

import { APP_NAME, UI } from "@/src/domain/strings";

import { DEMO_REQUEST_HREF } from "./plan-links";

type FooterLink = { href: string; label: string };

/**
 * The footer's link columns. Section links are rooted at `/`, so they also work from /privacy
 * and /terms; on the landing page itself they only scroll.
 */
const COLUMNS: ReadonlyArray<{ heading: string; links: readonly FooterLink[] }> = [
  {
    heading: "Explore",
    links: [
      { href: "/#problem", label: "The Problem" },
      { href: "/#system-features", label: "One System" },
      { href: "/#ai-narratives", label: "The Story" },
    ],
  },
  {
    heading: "Plans",
    links: [
      { href: "/#pricing", label: "Pricing" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
    ],
  },
];

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const LINK = `inline-flex items-center min-h-11 sm:min-h-0 rounded-sm text-[#edbca5]/85 hover:text-white transition-colors ${FOCUS}`;

/** In-page anchors are plain links; the legal pages are app routes. */
function FooterAnchor({ link }: { link: FooterLink }) {
  return link.href.startsWith("/#") ? (
    <a className={LINK} href={link.href}>
      {link.label}
    </a>
  ) : (
    <Link className={LINK} href={link.href}>
      {link.label}
    </Link>
  );
}

/**
 * The footer shared by the landing page and the legal pages: one rounded card in the brand's
 * espresso with a caramel glow, carrying the closing call to action (Book a demo), the brand,
 * the link columns and the legal line.
 *
 * The glows are placed where no text sits (the cream wash top right, the caramel low behind the
 * headline's start), so the white lettering keeps its contrast everywhere. No newsletter form:
 * there is no list to send to, and a form that goes nowhere would be worse than none.
 */
export function LandingFooter() {
  return (
    <footer className="bg-lp-surface px-3 sm:px-5 pt-10 pb-3 sm:pb-5">
      <div className="surface-dark relative isolate overflow-hidden rounded-2xl sm:rounded-[20px] bg-[#1a120d] text-white">
        {/* The mesh: soft radial glows over the dark base, blurred together. Decorative only. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-1/3 -right-1/4 h-[80%] w-[70%] rounded-full bg-[#f1dcc8]/70 blur-[90px]" />
          <div className="absolute top-[8%] -left-[15%] h-[70%] w-[65%] rounded-full bg-[#a8683d]/70 blur-[110px]" />
          <div className="absolute top-[30%] left-[30%] h-[75%] w-[60%] rounded-full bg-[#0f0a07] blur-[90px]" />
          <div className="absolute -bottom-1/3 -right-[10%] h-[70%] w-[55%] rounded-full bg-[#5b3a29]/60 blur-[100px]" />
        </div>

        <div className="px-6 sm:px-12 lg:px-16 pt-10 sm:pt-14 pb-6">
          <h2 className="max-w-xl text-3xl sm:text-4xl lg:text-5xl font-medium tracking-tight leading-[1.05] font-lp-serif">
            Ready to stay funded?
          </h2>
          <p className="mt-4 max-w-md text-[15px] sm:text-base text-white/80 leading-relaxed">
            Track, document and stay ready for your funders, from award to audit.
          </p>
          <a
            href={DEMO_REQUEST_HREF}
            className={`mt-6 inline-flex items-center justify-center min-h-11 px-6 rounded-xl bg-white text-[#3e2719] text-sm font-semibold shadow-lg shadow-black/20 hover:bg-[#f7eee6] transition-colors ${FOCUS}`}
          >
            Book a demo
          </a>

          <div className="mt-12 lg:mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="max-w-sm">
              {/* White capsule: the brown logo would vanish on the dark card. */}
              <Link href="/" className={`inline-flex items-center gap-2 rounded-full bg-white pl-1.5 pr-4 py-1 shadow-sm ${FOCUS}`}>
                <Image src="/brand/stayfunded-mark.png" alt="" width={628} height={570} className="h-7" style={{ width: "auto" }} />
                <Image src="/brand/stayfunded-wordmark.png" alt={APP_NAME} width={720} height={84} className="h-[15px]" style={{ width: "auto" }} />
              </Link>
              <p className="mt-4 text-sm text-white/75 leading-relaxed">
                Funding accountability and readiness for organizations that account for every dollar they receive.
              </p>
              <a href={`mailto:${UI.supportEmail}`} className={`${LINK} group mt-2 gap-1.5 text-sm break-all`}>
                {UI.supportEmail}
                {/* Up and to the right: this leaves the page for the mail app. */}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="w-3.5 h-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 11l6-6M6 5h5v5" />
                </svg>
              </a>
            </div>

            <nav aria-label="Footer" className="grid grid-cols-2 sm:grid-cols-3 gap-x-10 gap-y-8 lg:gap-x-16">
              {COLUMNS.map((column) => (
                <div key={column.heading}>
                  <h3 className="text-sm font-semibold text-white mb-3 sm:mb-4">{column.heading}</h3>
                  <ul className="space-y-0.5 sm:space-y-3 text-sm">
                    {column.links.map((link) => (
                      <li key={link.href}>
                        <FooterAnchor link={link} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>

          <p className="mt-10 pt-5 border-t border-white/10 text-center text-xs text-white/60">
            © {new Date().getFullYear()} {APP_NAME}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
