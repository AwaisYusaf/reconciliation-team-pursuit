"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The landing page's only interactive parts.
 *
 * The page itself is a server component: it is almost entirely static copy, and shipping all
 * 1,300 lines of it as client JavaScript to hydrate three behaviours cost every visitor the
 * download and the hydration for nothing. These three are what needs the browser — a reveal on
 * scroll, the header's scroll-spy, and the FAQ accordion — and the static markup passes into
 * them as children or plain data.
 */

/**
 * Scroll-triggered fade-and-rise, shared by every card grid on the page.
 *
 * Animates only `opacity`/`transform` — both are compositor-only properties the browser can
 * animate without re-running layout or paint, so this stays smooth even with a dozen of them
 * on screen at once. `once: true` (via `observer.disconnect()`) means each element pays this
 * cost exactly once per page load, not on every scroll back into view. `delayMs` staggers a
 * grid's cards a beat apart instead of having them all pop in on the same frame; `prefers-
 * reduced-motion` (globals.css, `.lp` scope) collapses the transition to instant for anyone
 * who's asked their OS for less motion, which is both an accessibility need and the correct
 * behavior for reduced-motion here — no animation to skip means no work to skip.
 */
export function Reveal({ children, delayMs = 0 }: { children: React.ReactNode; delayMs?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: visible ? `${delayMs}ms` : "0ms" }}
      className={`transition-all duration-700 ease-out will-change-transform ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      }`}
    >
      {children}
    </div>
  );
}

export type NavLink = { id: string; label: string };

/**
 * Scroll-spy for the header nav: tracks which section is under a thin band near the top
 * of the viewport (below the sticky header) so the matching link can be highlighted.
 */
function useActiveSection(ids: readonly string[]) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ids]);

  return activeId;
}

/** The header's section links, the one under the reader highlighted. */
export function LandingNav({ links }: { links: readonly NavLink[] }) {
  // Derived once per `links`, so the observer effect is not torn down on every render.
  const [ids] = useState(() => links.map((link) => link.id));
  const activeSection = useActiveSection(ids);

  return (
    <nav className="hidden lg:flex items-center space-x-6 text-xs font-medium text-[#edbca5]/85">
      {links.map((link) => (
        <a
          key={link.id}
          href={`#${link.id}`}
          aria-current={activeSection === link.id ? "location" : undefined}
          className={`transition-colors ${activeSection === link.id ? "text-white font-semibold" : "hover:text-white"}`}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

export type Faq = { question: string; answer: string };

/**
 * One question open at a time, the first open on arrival.
 *
 * A collapsed answer is squeezed to zero height so it can animate, which leaves it in the DOM
 * and in the reading order. `inert` takes it back out: without it a screen reader read every
 * closed answer aloud in turn, and nothing on screen said they were there. `aria-controls`
 * names the answer each button opens.
 */
export function FaqList({ faqs }: { faqs: readonly Faq[] }) {
  const [openFaq, setOpenFaq] = useState(0);

  return (
    <div className="lg:col-span-8 flex flex-col gap-3">
      {faqs.map((faq, index) => {
        const isOpen = openFaq === index;
        const answerId = `faq-answer-${index}`;
        return (
          <div
            key={faq.question}
            className={
              isOpen
                ? "bg-lp-surface-container-lowest border border-primary/30 rounded-2xl shadow-warm-card px-6 py-5 transition-[background-color,border-color,box-shadow,transform] duration-300 ease-out"
                : "bg-lp-surface-container-low rounded-2xl px-6 py-2.5 transition-[background-color,border-color,box-shadow,transform] duration-300 ease-out hover:bg-lp-surface-container hover:-translate-y-0.5"
            }
          >
            <button
              type="button"
              // 44px: the whole row is the target on a phone, not the line of text inside it.
              className="w-full min-h-11 flex items-center justify-between gap-4 text-left cursor-pointer"
              aria-expanded={isOpen}
              aria-controls={answerId}
              onClick={() => setOpenFaq(isOpen ? -1 : index)}
            >
              <span
                className={
                  isOpen
                    ? "text-base sm:text-lg font-semibold text-on-surface font-lp-serif transition-colors duration-300"
                    : "text-sm sm:text-base font-medium text-on-surface-variant font-lp-serif transition-colors duration-300"
                }
              >
                {faq.question}
              </span>
              <span
                className={
                  isOpen
                    ? "flex-shrink-0 w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center rotate-45 transition-transform transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    : "flex-shrink-0 w-7 h-7 rounded-full bg-lp-surface-container text-on-surface-variant flex items-center justify-center rotate-0 transition-transform transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                }
              >
                <svg viewBox="0 0 12 12" aria-hidden="true" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 1v10M1 6h10" /></svg>
              </span>
            </button>
            <div
              id={answerId}
              inert={!isOpen}
              className={
                isOpen
                  ? "grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-300 ease-out"
                  : "grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-300 ease-out"
              }
            >
              <p className="text-sm text-on-surface-variant leading-relaxed overflow-hidden min-h-0 pt-3">
                {faq.answer}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
