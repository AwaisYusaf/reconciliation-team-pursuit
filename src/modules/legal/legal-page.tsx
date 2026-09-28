import Image from "next/image";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { APP_NAME, UI } from "@/src/domain/strings";
import { LandingFooter } from "@/src/modules/landing/landing-footer";

/**
 * The public legal pages (/privacy, /terms): one layout, with each document's words kept as
 * data in its own file so a lawyer's edits touch text only. A block is a paragraph or a list;
 * `{email}`, `{privacy}` and `{terms}` in any line become links, so the support address and the
 * cross-links are written once.
 */
export type LegalBlock = string | { list: readonly string[] };
export type LegalSection = { id: string; title: string; blocks: readonly LegalBlock[] };
export type LegalDocument = {
  title: string;
  /** Shown under the title, e.g. "September 28, 2026". */
  updated: string;
  intro: readonly string[];
  sections: readonly LegalSection[];
};

/** The company that provides the service, named in both documents. */
export const LEGAL_PROVIDER = "Authentic Business";
export const LEGAL_UPDATED = "September 28, 2026";

const LINK = "text-brand-800 underline underline-offset-2 hover:text-brand-900";

/** Turns the `{email}`, `{privacy}` and `{terms}` tokens in a line into links. */
function withLinks(text: string): ReactNode {
  return text.split(/(\{email\}|\{privacy\}|\{terms\})/).map((part, i) => {
    if (part === "{email}") {
      return (
        <a key={i} className={LINK} href={`mailto:${UI.supportEmail}`}>
          {UI.supportEmail}
        </a>
      );
    }
    if (part === "{privacy}") {
      return (
        <Link key={i} className={LINK} href="/privacy">
          Privacy Policy
        </Link>
      );
    }
    if (part === "{terms}") {
      return (
        <Link key={i} className={LINK} href="/terms">
          Terms of Service
        </Link>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") return <p>{withLinks(block)}</p>;
  return (
    <ul className="list-disc pl-5 space-y-2 marker:text-brand-700">
      {block.list.map((item, i) => (
        <li key={i}>{withLinks(item)}</li>
      ))}
    </ul>
  );
}

export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <>
      <header className="sticky top-0 z-50 px-4 sm:px-6 py-3">
        <div className="surface-dark max-w-3xl mx-auto rounded-full bg-[#38231a] border border-[#5b3a29] shadow-xl shadow-black/40 pl-2.5 sm:pl-3 pr-2.5 sm:pr-3 py-2 flex items-center justify-between gap-3">
          {/* White so the brown logo reads on the pill, as on the landing page. */}
          <Link
            className="flex items-center gap-2 rounded-full bg-white pl-1.5 pr-3 sm:pr-4 py-1 shadow-sm"
            href="/"
          >
            <Image src="/brand/stayfunded-mark.png" alt="" width={628} height={570} className="h-7" style={{ width: "auto" }} loading="eager" />
            <Image src="/brand/stayfunded-wordmark.png" alt={APP_NAME} width={720} height={84} className="h-[13px] sm:h-[15px]" style={{ width: "auto" }} loading="eager" />
          </Link>
          <Link
            className="whitespace-nowrap inline-flex items-center min-h-11 text-[#edbca5]/85 hover:text-white text-xs font-medium px-2 transition-colors"
            href="/"
          >
            Back to home
          </Link>
        </div>
      </header>

      {/* From `lg` the contents sit in a left column that stays in view while the document
          scrolls; below that there is no room beside the text, so they come first, above it. */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-20 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-14">
        <aside className="hidden lg:block">
          {/* Fits without scrolling on an ordinary screen; on a very short one it scrolls, with the
              bar hidden so it never sits beside the list as it did. */}
          <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Contents sections={document.sections} headingId="legal-contents-side" />
          </div>
        </aside>

        <div className="min-w-0 max-w-3xl">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-3">
            {document.title}
          </h1>
          <p className="text-sm text-on-surface-variant mb-8">Last updated: {document.updated}</p>

          <div className="space-y-4 text-[15px] sm:text-base text-on-surface-variant leading-relaxed mb-10">
            {document.intro.map((line, i) => (
              <p key={i}>{withLinks(line)}</p>
            ))}
          </div>

          <div className="lg:hidden rounded-2xl border border-outline-variant bg-lp-surface-container-low p-5 sm:p-6 mb-12">
            <Contents sections={document.sections} headingId="legal-contents" columns />
          </div>

          <div className="space-y-12">
          {document.sections.map((section, index) => (
            // `scroll-mt` so a heading reached from the contents clears the sticky header.
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-28">
              <h2
                id={`${section.id}-title`}
                className="text-xl sm:text-2xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4"
              >
                {index + 1}. {section.title}
              </h2>
              <div className="space-y-4 text-[15px] sm:text-base text-on-surface-variant leading-relaxed">
                {section.blocks.map((block, i) => (
                  <Block key={i} block={block} />
                ))}
              </div>
            </section>
          ))}
          </div>
        </div>
      </main>

      <LandingFooter />
    </>
  );
}

/** The numbered list of sections, linking to each. `columns`: two columns from `sm`, for the
 *  box above the text; the side column is one narrow column. */
function Contents({
  sections,
  headingId,
  columns = false,
}: {
  sections: readonly LegalSection[];
  headingId: string;
  columns?: boolean;
}) {
  return (
    <nav aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-800 mb-3">
        Contents
      </h2>
      {/* Numbers drawn in their own right-aligned column, not as list markers: a marker sits
          outside the box, so "10." was clipped to "l0." and a wrapped title lost its number. */}
      <ol className={`grid gap-y-0.5 text-[13.5px] ${columns ? "gap-x-6 sm:grid-cols-2" : ""}`}>
        {sections.map((section, index) => (
          <li key={section.id}>
            <a
              className="group flex gap-2 rounded-md px-2 py-1 -mx-2 text-on-surface hover:bg-lp-surface-container hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand-800"
              href={`#${section.id}`}
            >
              <span aria-hidden="true" className="w-5 shrink-0 text-right tabular-nums text-on-surface-variant group-hover:text-brand-800">
                {index + 1}.
              </span>
              <span className="leading-snug">{section.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
