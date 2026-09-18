"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { APP_NAME } from "@/src/domain/strings";

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
function Reveal({ children, delayMs = 0 }: { children: React.ReactNode; delayMs?: number }) {
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

/** Kept as the name the 5-step flow section already reads. */
const FlowStep = Reveal;

const NAV_LINKS = [
  { id: "problem", label: "The Problem" },
  { id: "system-features", label: "Features" },
  { id: "ai-narratives", label: "AI Summaries" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
];
const NAV_SECTION_IDS = NAV_LINKS.map((link) => link.id);

/**
 * Scroll-spy for the header nav: tracks which section is under a thin band near the top
 * of the viewport (below the sticky header) so the matching link can be highlighted.
 */
function useActiveSection(ids: string[]) {
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

const FAQS = [
  {
    question: `Does ${APP_NAME} replace our existing Excel spreadsheets?`,
    answer:
      `Yes. ${APP_NAME} replaces manual spreadsheet reconciliation with a single ledger where every expense is captured once, with its documentation, at the moment it happens. There's no more retyping totals across separate Word and Excel files.`,
  },
  {
    question: "What happens if an expense is missing a receipt or bank proof?",
    answer:
      `${APP_NAME}'s hard documentation gate physically prevents staff from generating a monthly packet until every expense has both an itemized receipt and proof of payment attached, so incomplete expenses can't slip through to filing.`,
  },
  {
    question: `Can ${APP_NAME} handle multiple grant contracts at once?`,
    answer:
      "Yes. The Reconciliation + AI plan ($497/month) supports multiple contracts with custom grant contract template customization, on top of everything in the single-contract Reconciliation plan ($297/month).",
  },
  {
    question: "How long does it take to generate a month-end filing packet?",
    answer:
      "One click compiles the official Word cover sheet, Excel sub-ledger, and a merged filing PDF under 25MB. Team Pursuit Global in Detroit went from a 3-day manual reconciliation ordeal to a 30-minute formality.",
  },
  {
    question: "How long are our records retained, and is the audit trail tamper-proof?",
    answer:
      "Every change, category assignment, and upload is timestamped and cryptographically logged for 7-year record retention, with a tamper-evident audit seal locking each record against post-filing alterations.",
  },
];

export function LandingPage() {
  const [openFaq, setOpenFaq] = useState(0);
  const activeSection = useActiveSection(NAV_SECTION_IDS);
  return (
    <>
<header className="sticky top-0 z-50 transition-all duration-200 px-4 sm:px-6 py-3">
<div className="max-w-3xl mx-auto rounded-full bg-[#38231a] border border-[#5b3a29] shadow-xl shadow-black/40 pl-2.5 sm:pl-3 pr-2.5 sm:pr-3 py-2 flex items-center justify-between">

{/* The full logo's own artwork, laid out side by side: its stacked form (mark over wordmark
    over tagline) would be unreadable at nav height. White so the brown logo reads on the pill. */}
<Link
  className="flex items-center gap-2 rounded-full bg-white pl-1.5 pr-4 py-1 shadow-sm transition-transform hover:scale-[1.02]"
  href="/"
>
<Image src="/brand/stayfunded-mark.png" alt="" width={628} height={570} className="h-7" style={{ width: "auto" }} priority />
<Image src="/brand/stayfunded-wordmark.png" alt={APP_NAME} width={720} height={84} className="h-[15px]" style={{ width: "auto" }} priority />
</Link>

<nav className="hidden lg:flex items-center space-x-6 text-xs font-medium text-[#edbca5]/85">
{NAV_LINKS.map((link) => (
<a
  key={link.id}
  href={`#${link.id}`}
  className={`transition-colors ${activeSection === link.id ? "text-white font-semibold" : "hover:text-white"}`}
>
  {link.label}
</a>
))}
</nav>

<div className="flex items-center space-x-3 sm:space-x-4">
<a
  className="bg-lp-surface-container-lowest/80 backdrop-blur-md border border-outline-variant/65 text-on-surface inline-flex items-center justify-center px-4 sm:px-5 py-1.5 rounded-full text-xs font-semibold shadow-[0_2px_6px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.5)]"
  href="/login"
>
        Get Started
      </a>
</div>
</div>
</header>
<main>
<section className="relative pt-14 pb-20 lg:pt-20 lg:pb-28 overflow-hidden bg-gradient-to-b from-lp-surface via-lp-surface-container-low to-lp-surface" data-purpose="hero-section">

<div className="absolute top-0 right-0 -mr-48 -mt-24 w-[650px] h-[500px] bg-gradient-to-br from-brand-300/25 via-terracotta-200/20 to-transparent blur-3xl pointer-events-none rounded-full"></div>
<div className="absolute top-48 -left-36 w-[550px] h-[450px] bg-gradient-to-tr from-amber-200/20 via-brand-200/25 to-transparent blur-3xl pointer-events-none rounded-full"></div>
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
<div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-center">
<div className="text-left">

<div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-6 shadow-xs">
<span className="w-2 h-2 rounded-full bg-brand-700 animate-pulse"></span> Built for grant-funded nonprofit reconciliation
        </div>

<h1 className="text-3xl sm:text-4xl lg:text-4xl xl:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif leading-[1.15] mb-5">
          Take control of <span className="text-primary italic font-lp-serif">your</span>{" "}<br /><span className="text-primary italic font-lp-serif">monthly reconciliation.</span>
</h1>

<p className="text-sm sm:text-base lg:text-lg text-on-surface-variant leading-relaxed max-w-2xl mb-7">
          Capture every expense once, with its documentation, the moment it happens. When the month closes, generate a complete, funder-ready packet, cover sheets, contract summary, and merged filing, in minutes.
        </p>

<div className="flex flex-wrap items-center gap-4">
<a
  className="glass-btn glass-btn-primary group inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold"
  href="/login"
  style={{ background: "color-mix(in srgb, var(--color-brand-900) 90%, transparent)" }}
>
            <span>Get Started</span>
            <span className="glass-btn-arrow">
              <svg className="w-3.5 h-3.5 -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3"></path></svg>
            </span>
          </a>
<a className="glass-btn glass-btn-light px-5 py-2.5 rounded-full text-sm font-semibold" href="#pricing">
            See How It Works
          </a>
</div>
</div>

<div className="relative w-full overflow-hidden">
  <div className="relative w-full aspect-[3944/2564] overflow-hidden">
    
    <div className="absolute z-10 overflow-hidden bg-lp-surface-container-lowest text-left select-none" style={{ top: "9.91%", left: "10.5%", right: "10.55%", bottom: "7.06%" }}>
      <div className="relative pt-3 px-3 pb-1.5 sm:pt-4 sm:px-4 sm:pb-2 lg:pt-5 lg:px-5 lg:pb-2.5 bg-lp-surface-container-lowest h-full flex flex-col select-none">


  <div className="border-b border-outline-variant/50 pb-1 sm:pb-1.5 mb-1.5 sm:mb-2">
    <nav className="flex items-center gap-1.5 sm:gap-2.5 overflow-hidden text-[6px] sm:text-[8px] font-medium text-on-surface-variant">
      <a className="pb-2 -mb-2 border-b-2 border-primary text-on-surface font-semibold whitespace-nowrap" href="#">Dashboard</a>
      <a className="pb-2 -mb-2 border-b-2 border-transparent hover:text-on-surface whitespace-nowrap" href="#">Add Expense</a>
      <a className="pb-2 -mb-2 border-b-2 border-transparent hover:text-on-surface whitespace-nowrap" href="#">Expenses</a>
      <a className="pb-2 -mb-2 border-b-2 border-transparent hover:text-on-surface whitespace-nowrap" href="#">Cover Sheets</a>
      <a className="pb-2 -mb-2 border-b-2 border-transparent hover:text-on-surface whitespace-nowrap" href="#">Recurring</a>
      <a className="pb-2 -mb-2 border-b-2 border-transparent hover:text-on-surface whitespace-nowrap" href="#">Month-End Packet</a>
      <a className="pb-2 -mb-2 border-b-2 border-transparent hover:text-on-surface whitespace-nowrap" href="#">Contract Summary</a>
      <a className="pb-2 -mb-2 border-b-2 border-transparent hover:text-on-surface whitespace-nowrap" href="#">Line Items</a>
      <a className="pb-2 -mb-2 border-b-2 border-transparent hover:text-on-surface whitespace-nowrap" href="#">Settings</a>
    </nav>
  </div>

  <div className="mb-1.5 sm:mb-2">
    <h2 className="text-[10px] sm:text-xs lg:text-sm font-semibold text-on-surface font-lp-serif tracking-tight leading-none">Dashboard</h2>
    <p className="text-[7px] sm:text-[8px] text-on-surface-variant font-normal leading-tight mt-0.5">Budget status for August 2026.</p>
  </div>

  <div className="grid grid-cols-3 gap-1 sm:gap-1.5 mb-1.5 sm:mb-2">
    <div className="bg-lp-surface-container-lowest/70 backdrop-blur-md border border-outline-variant/50 rounded-lg p-1 sm:p-1.5 flex flex-col gap-0.5 justify-between ring-1 ring-inset ring-white/40">
      <span className="text-[6px] sm:text-[7px] font-semibold uppercase tracking-wider text-on-surface-variant truncate">Original Approved Budget</span>
      <div className="text-[9px] sm:text-xs lg:text-sm font-semibold text-on-surface font-lp-serif tracking-tight whitespace-nowrap">$598,692.00</div>
    </div>
    <div className="bg-lp-surface-container-lowest/70 backdrop-blur-md border border-outline-variant/50 rounded-lg p-1 sm:p-1.5 flex flex-col gap-0.5 justify-between ring-1 ring-inset ring-white/40">
      <span className="text-[6px] sm:text-[7px] font-semibold uppercase tracking-wider text-on-surface-variant truncate">Total Spent To Date</span>
      <div className="text-[9px] sm:text-xs lg:text-sm font-semibold text-on-surface font-lp-serif tracking-tight whitespace-nowrap">$22,220.00</div>
    </div>
    <div className="bg-lp-surface-container-lowest/70 backdrop-blur-md border border-outline-variant/50 rounded-lg p-1 sm:p-1.5 flex flex-col gap-0.5 justify-between ring-1 ring-inset ring-white/40">
      <span className="text-[6px] sm:text-[7px] font-semibold uppercase tracking-wider text-on-surface-variant truncate">Total Remaining</span>
      <div className="text-[9px] sm:text-xs lg:text-sm font-semibold text-on-surface font-lp-serif tracking-tight whitespace-nowrap">$576,472.00</div>
    </div>
  </div>
  <p className="text-[6px] sm:text-[8px] text-on-surface-variant/80 italic mb-1.5 sm:mb-2 leading-snug">The whole grant to date, across every month - 4% of the approved budget committed.</p>

  <div className="mb-1 sm:mb-1.5">
    <h3 className="text-[9px] sm:text-[11px] lg:text-xs font-semibold text-on-surface font-lp-serif tracking-tight leading-tight">August 2026 on its own</h3>
    <p className="text-[6px] sm:text-[8px] text-on-surface-variant leading-snug mt-0.5">Opening balance, what this month spent, and what is left at the end of it. Each month starts where the last one closed.</p>
  </div>

  <div className="bg-lp-surface-container-lowest/70 backdrop-blur-md rounded-lg border border-outline-variant/50 overflow-hidden flex-1 ring-1 ring-inset ring-white/40">
    <table className="w-full text-left text-[6px] sm:text-[8px] lg:text-[9px]">
      <thead>
        <tr className="border-b-2 border-on-surface/70 font-semibold uppercase tracking-wider text-on-surface-variant">
          <th className="py-1 sm:py-1.5 px-1.5 sm:px-2 font-semibold text-left">Line Item</th>
          <th className="py-1 sm:py-1.5 px-1.5 sm:px-2 font-semibold text-right">Opening Balance</th>
          <th className="py-1 sm:py-1.5 px-1.5 sm:px-2 font-semibold text-right">Spent In Aug</th>
          <th className="py-1 sm:py-1.5 px-1.5 sm:px-2 font-semibold text-right">Closing Balance</th>
        </tr>
      </thead>
      <tbody className="text-on-surface divide-y divide-outline-variant/20">
        <tr className="hover:bg-lp-surface-container-low/50 transition-colors">
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 font-medium text-on-surface">Salary</td>
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 text-right font-mono text-on-surface-variant">$444,692.00</td>
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 text-right font-mono text-tertiary font-semibold">$5,032.00</td>
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 text-right font-mono font-semibold text-on-surface">$439,660.00</td>
        </tr>
        <tr className="hover:bg-lp-surface-container-low/50 transition-colors">
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 font-medium text-on-surface">Analytical Support</td>
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 text-right font-mono text-on-surface-variant">$79,412.00</td>
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 text-right font-mono text-tertiary font-semibold">$600.00</td>
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 text-right font-mono font-semibold text-on-surface">$78,812.00</td>
        </tr>
        <tr className="hover:bg-lp-surface-container-low/50 transition-colors">
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 font-medium text-on-surface">Field Operations &amp; Supplies</td>
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 text-right font-mono text-on-surface-variant">$48,588.00</td>
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 text-right font-mono text-tertiary font-semibold">$1,240.00</td>
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 text-right font-mono font-semibold text-on-surface">$47,348.00</td>
        </tr>
        <tr className="hover:bg-lp-surface-container-low/50 transition-colors">
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 font-medium text-on-surface">Participant Support &amp; Travel</td>
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 text-right font-mono text-on-surface-variant">$26,000.00</td>
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 text-right font-mono text-tertiary font-semibold">$1,548.00</td>
          <td className="py-1 sm:py-1.5 px-1.5 sm:px-2 text-right font-mono font-semibold text-on-surface">$24,452.00</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
    </div>
    
    <Image
      alt="MacBook Pro 14 Display Mockup"
      src="/macbook-pro-14-front.png"
      fill
      priority
      sizes="(min-width: 1024px) 1024px, 100vw"
      className="pointer-events-none z-20 select-none object-contain"
    />
  </div>
</div>
</div>

<div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 text-sm text-on-surface-variant">
<div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-lp-surface-container border border-outline-variant/50 text-[11px] text-on-surface-variant">
<span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
<span className="">Field-tested with <strong className="text-on-surface font-semibold">Team Pursuit Global</strong> in Detroit to turn a 3-day ordeal into a 30-minute formality.</span>
</div>
</div>
</div>
</section>
<section className="py-24 bg-lp-surface-container-low border-y border-outline-variant/40" data-purpose="problem-section" id="problem">
<Reveal>
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
<div className="inline-flex items-center px-3.5 py-1 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-4">
        The Cost of Manual Reconciliation
      </div>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4 max-w-3xl mx-auto">
        Manual reconciliation shouldn&apos;t take three days every month, or cost weeks of delayed reimbursement.
      </h2>
<p className="text-base sm:text-lg text-on-surface-variant max-w-2xl mx-auto mb-16">
        When receipts live in text threads and totals are retyped across Word and Excel, compliance breaks down. Nonprofits lose cash flow while reviewers bounce packets back for revision.
      </p>

<div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">

<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-8 border-2 border-primary/45 shadow-warm-card flex flex-col justify-between ring-1 ring-inset ring-white/30">
<div>
<div className="flex items-center justify-between mb-4">
<div className="w-10 h-10 rounded-xl bg-terracotta-100/75 backdrop-blur-md text-terracotta-700 ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold">
<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
</div>
<span className="text-xs font-semibold font-mono text-tertiary bg-tertiary-container/60 px-2.5 py-1 rounded-full">24+ Staff Hours Lost</span>
</div>
<h3 className="text-xl font-semibold text-on-surface font-lp-serif mb-2">Scattered Receipts &amp; Lost Hours</h3>
<p className="text-xs sm:text-sm text-on-surface-variant mb-6 leading-relaxed">
              Staff spend 2 to 3 full working days every month tracking down lost vendor slips from bank statements, WhatsApp chats, and inbox clutter instead of serving community youth and families.
            </p>
</div>
<div className="glass-tile w-full bg-lp-surface-container/60 backdrop-blur-lg rounded-2xl p-4 flex flex-col gap-2.5 border-2 border-primary/18 ring-1 ring-inset ring-white/25">
<div className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-lp-surface-container-lowest/70 backdrop-blur-md border border-tertiary/20 text-tertiary shadow-xs">
<span className="flex items-center gap-1.5 font-medium truncate">
<svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
                Staples Office Pack
              </span>
<span className="font-semibold text-[10px] bg-tertiary-container text-tertiary px-2 py-0.5 rounded">Missing Proof of Pay</span>
</div>
<div className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-lp-surface-container-lowest/70 backdrop-blur-md border border-outline-variant/50 text-on-surface-variant">
<span className="">Youth Workshop Refreshments</span>
<span className="text-[11px] text-on-surface-variant/70 italic">Unattached receipt PDF</span>
</div>
</div>
</div>

<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-8 border-2 border-primary/45 shadow-warm-card flex flex-col justify-between ring-1 ring-inset ring-white/30">
<div>
<div className="flex items-center justify-between mb-4">
<div className="w-10 h-10 rounded-xl bg-amber-100/75 backdrop-blur-md text-amber-800 ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold">
<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
</div>
<span className="text-xs font-semibold font-mono text-amber-800 bg-amber-100 px-2.5 py-1 rounded-full">Budget Drift Risk</span>
</div>
<h3 className="text-xl font-semibold text-on-surface font-lp-serif mb-2">Zero Early Warning on Drift</h3>
<p className="text-xs sm:text-sm text-on-surface-variant mb-6 leading-relaxed">
              Without continuous real-time ledger tracking, directors only discover an overspent budget line when month-end books close, putting grant compliance and reimbursement guarantees at immediate risk.
            </p>
</div>
<div className="glass-tile w-full bg-lp-surface-container/60 backdrop-blur-lg rounded-2xl p-4 border-2 border-primary/18 ring-1 ring-inset ring-white/25">
<div className="flex justify-between items-center text-xs mb-2">
<span className="font-semibold text-on-surface">Participant Support Line</span>
<span className="font-semibold text-tertiary text-[11px]">104% Overcommitted</span>
</div>
<div className="w-full bg-lp-surface-container-highest rounded-full h-2.5 overflow-hidden mb-2">
<div className="bg-tertiary h-2.5 rounded-full" style={{ width: "100%" }}></div>
</div>
<p className="text-[11px] text-on-surface-variant">Discovered 22 days after spending occurred.</p>
</div>
</div>

<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-8 border-2 border-primary/45 shadow-warm-card flex flex-col justify-between ring-1 ring-inset ring-white/30">
<div>
<div className="flex items-center justify-between mb-4">
<div className="w-10 h-10 rounded-xl bg-brand-100/75 backdrop-blur-md text-brand-800 ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold">
<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
</div>
<span className="text-xs font-semibold font-mono text-tertiary bg-tertiary-container/60 px-2.5 py-1 rounded-full">4–6 Wk Payment Holds</span>
</div>
<h3 className="text-xl font-semibold text-on-surface font-lp-serif mb-2">Rejected Filing Packets</h3>
<p className="text-xs sm:text-sm text-on-surface-variant mb-6 leading-relaxed">
              Mismatched formula totals between cover sheet tables and Excel summaries trigger instant audit kicks. The review clock resets to day one, trapping non-profit payroll in limbo.
            </p>
</div>
<div className="glass-tile w-full bg-lp-surface-container/60 backdrop-blur-lg rounded-2xl p-4 flex flex-col gap-2 border-2 border-primary/18 ring-1 ring-inset ring-white/25">
<div className="flex items-center justify-between text-xs">
<span className="text-on-surface-variant">Municipal Reviewer Portal</span>
<span className="font-semibold text-tertiary">Status: REJECTED</span>
</div>
<div className="flex items-center justify-between text-xs">
<span className="text-on-surface-variant">Cover Sheet vs Ledger</span>
<span className="font-semibold text-tertiary text-[11px]">Variance $180.00</span>
</div>
<div className="text-[11px] text-brand-900 bg-brand-100/75 backdrop-blur-md p-2 rounded-lg border border-brand-200/60 mt-1">
              &quot;Filing returned. Contract reimbursement held pending resubmission.&quot;
            </div>
</div>
</div>
</div>
</div>
</Reveal>
</section>
<section className="py-24 bg-lp-surface" data-purpose="flow-section" id="flow">
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{
    __html: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: "The 5-Step Evidence Flow",
      description:
        "How every single dollar spent becomes an indisputable, audit-defensible proof record.",
      step: [
        {
          "@type": "HowToStep",
          position: 1,
          name: "Capture at Event",
          text: "Log payee, amount, date, and card/check source at the exact moment of payment.",
        },
        {
          "@type": "HowToStep",
          position: 2,
          name: "Proof & Receipt Gate",
          text: "Attach itemized receipt and bank proof. Gate prevents locking incomplete expenses.",
        },
        {
          "@type": "HowToStep",
          position: 3,
          name: "Line-Item Mapping",
          text: "Directly assign against approved contract budget lines or split between multiple codes.",
        },
        {
          "@type": "HowToStep",
          position: 4,
          name: "Variance Check",
          text: "Continuous live depletion check. Prevents inadvertent category overspends in real time.",
        },
        {
          "@type": "HowToStep",
          position: 5,
          name: "1-Click Compilation",
          text: "Generates official Word cover sheet, Excel sub-ledger, and <25MB merged filing PDF.",
        },
      ],
    }).replace(/</g, "\\u003c"),
  }}
/>
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
<div className="text-center max-w-3xl mx-auto mb-16">
<div className="inline-flex items-center px-3.5 py-1 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-4">
          From Expense to Evidence
        </div>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4">
          The 5-Step Evidence Flow
        </h2>
<p className="text-base sm:text-lg text-on-surface-variant">
          How every single dollar spent becomes an indisputable, audit-defensible proof record.
        </p>
</div>

<div className="max-w-2xl mx-auto">

<FlowStep>
<div className="flex gap-5">
<div className="flex flex-col items-center flex-shrink-0">
<div className="w-9 h-9 rounded-full bg-primary text-white font-semibold text-xs flex items-center justify-center flex-shrink-0">1</div>
<div className="w-0.5 flex-1 bg-primary/25 mt-2"></div>
</div>
<div className="flex-1 pb-8">
<h3 className="text-lg sm:text-xl font-semibold text-on-surface font-lp-serif mb-1.5">Capture at Event</h3>
<p className="text-sm sm:text-base text-on-surface-variant leading-relaxed mb-2">
              Log payee, amount, date, and card/check source at the exact moment of payment.
            </p>
<span className="text-[10px] font-mono text-secondary font-semibold uppercase tracking-wide">No Backtracking</span>
</div>
</div>
</FlowStep>

<FlowStep>
<div className="flex gap-5">
<div className="flex flex-col items-center flex-shrink-0">
<div className="w-9 h-9 rounded-full bg-primary text-white font-semibold text-xs flex items-center justify-center flex-shrink-0">2</div>
<div className="w-0.5 flex-1 bg-primary/25 mt-2"></div>
</div>
<div className="flex-1 pb-8">
<h3 className="text-lg sm:text-xl font-semibold text-on-surface font-lp-serif mb-1.5">Proof &amp; Receipt Gate</h3>
<p className="text-sm sm:text-base text-on-surface-variant leading-relaxed mb-2">
              Attach itemized receipt and bank proof. Gate prevents locking incomplete expenses.
            </p>
<span className="text-[10px] font-mono text-terracotta-700 font-semibold uppercase tracking-wide">Dual Verification</span>
</div>
</div>
</FlowStep>

<FlowStep>
<div className="flex gap-5">
<div className="flex flex-col items-center flex-shrink-0">
<div className="w-9 h-9 rounded-full bg-primary text-white font-semibold text-xs flex items-center justify-center flex-shrink-0">3</div>
<div className="w-0.5 flex-1 bg-primary/25 mt-2"></div>
</div>
<div className="flex-1 pb-8">
<h3 className="text-lg sm:text-xl font-semibold text-on-surface font-lp-serif mb-1.5">Line-Item Mapping</h3>
<p className="text-sm sm:text-base text-on-surface-variant leading-relaxed mb-2">
              Directly assign against approved contract budget lines or split between multiple codes.
            </p>
<span className="text-[10px] font-mono text-brand-800 font-semibold uppercase tracking-wide">Approved Budget Lines Only</span>
</div>
</div>
</FlowStep>

<FlowStep>
<div className="flex gap-5">
<div className="flex flex-col items-center flex-shrink-0">
<div className="w-9 h-9 rounded-full bg-primary text-white font-semibold text-xs flex items-center justify-center flex-shrink-0">4</div>
<div className="w-0.5 flex-1 bg-primary/25 mt-2"></div>
</div>
<div className="flex-1 pb-8">
<h3 className="text-lg sm:text-xl font-semibold text-on-surface font-lp-serif mb-1.5">Variance Check</h3>
<p className="text-sm sm:text-base text-on-surface-variant leading-relaxed mb-2">
              Continuous live depletion check. Prevents inadvertent category overspends in real time.
            </p>
<span className="text-[10px] font-mono text-secondary font-semibold uppercase tracking-wide">Live Depletion</span>
</div>
</div>
</FlowStep>

<FlowStep>
<div className="flex gap-5">
<div className="flex flex-col items-center flex-shrink-0">
<div className="w-9 h-9 rounded-full bg-secondary text-white font-semibold text-xs flex items-center justify-center flex-shrink-0">5</div>
</div>
<div className="flex-1">
<h3 className="text-lg sm:text-xl font-semibold text-on-surface font-lp-serif mb-1.5">1-Click Compilation</h3>
<p className="text-sm sm:text-base text-on-surface-variant leading-relaxed mb-2">
              Generates official Word cover sheet, Excel sub-ledger, and &lt;25MB merged filing PDF.
            </p>
<span className="text-[10px] font-mono text-secondary font-semibold uppercase tracking-wide">Funder-Ready</span>
</div>
</div>
</FlowStep>

</div>
</div>
</section>
<section className="py-24 bg-lp-surface-container-low border-y border-outline-variant/40" data-purpose="record-spec-section" id="record-spec">
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{
    __html: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "The 9-Point Defense",
      description:
        `The 9 attributes ${APP_NAME} enforces before an expense can enter the filing packet.`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Verified Payee" },
        { "@type": "ListItem", position: 2, name: "Contract Period" },
        { "@type": "ListItem", position: 3, name: "Line-Item Match" },
        { "@type": "ListItem", position: 4, name: "Reconciled Amount" },
        { "@type": "ListItem", position: 5, name: "Bank Account" },
        { "@type": "ListItem", position: 6, name: "Vendor Invoice" },
        { "@type": "ListItem", position: 7, name: "Proof of Payment" },
        { "@type": "ListItem", position: 8, name: "Program Justification" },
        { "@type": "ListItem", position: 9, name: "Audit Seal" },
      ],
    }).replace(/</g, "\\u003c"),
  }}
/>
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
<div className="text-center max-w-3xl mx-auto mb-16">
<div className="inline-flex items-center px-3.5 py-1 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-4">
          Data Integrity Architecture
        </div>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4">
          What Each Transaction Record Holds
        </h2>
<p className="text-base sm:text-lg text-on-surface-variant">
          Every individual entry is structured to satisfy rigorous municipal, state, and federal grant oversight standards.
        </p>
</div>

<div className="max-w-3xl mx-auto glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-6 sm:p-10 border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">

<div className="flex items-center justify-between border-b border-outline-variant/40 pb-5 mb-2">
<div>
<span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">Record #EXP-2026-084</span>
<h3 className="text-lg sm:text-xl font-semibold text-on-surface font-lp-serif mt-0.5">Youth Mentorship Safe Passage Transit</h3>
</div>
<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary-container text-[#002113] text-xs font-semibold border border-secondary/30 flex-shrink-0">
<span className="w-2 h-2 rounded-full bg-secondary"></span> Validated
            </span>
</div>

<dl className="divide-y divide-outline-variant/20 text-sm">
<div className="flex items-center justify-between py-3">
<dt className="text-xs text-on-surface-variant">Payee &amp; Vendor</dt>
<dd className="font-semibold text-on-surface text-right">Detroit Metro Van Charters LLC</dd>
</div>
<div className="flex items-center justify-between py-3">
<dt className="text-xs text-on-surface-variant">Date</dt>
<dd className="font-semibold text-on-surface text-right">February 14, 2026</dd>
</div>
<div className="flex items-center justify-between py-3">
<dt className="text-xs text-on-surface-variant">Category</dt>
<dd className="font-semibold text-primary text-right">Participant Support &amp; Travel</dd>
</div>
<div className="flex items-center justify-between py-3">
<dt className="text-xs text-on-surface-variant">Amount</dt>
<dd className="font-semibold text-on-surface font-mono text-right">$1,450.00</dd>
</div>
<div className="flex items-center justify-between py-3">
<dt className="text-xs text-on-surface-variant">Payment Source</dt>
<dd className="font-semibold text-on-surface text-right">Debit #4902</dd>
</div>
<div className="flex items-center justify-between py-3 gap-4">
<dt className="text-xs text-on-surface-variant flex-shrink-0">Documentation</dt>
<dd className="font-semibold text-secondary text-right flex items-center gap-1.5 justify-end">
<svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
Receipt + Bank Proof
            </dd>
</div>
</dl>

<div className="pt-3">
<span className="text-xs text-on-surface-variant">Business Purpose: </span>
<span className="text-xs text-on-surface">Roundtrip transportation for 28 CVI youth participants to evening conflict de-escalation seminar.</span>
</div>

<div className="mt-5 p-3 rounded-xl bg-brand-50/70 backdrop-blur-md border border-brand-200/60 flex items-center justify-between text-xs">
<span className="font-mono text-brand-900 font-semibold uppercase text-[10px]">Audit Seal</span>
<span className="text-brand-950 font-mono font-medium text-[11px]">STAMPED • ZERO DRIFT</span>
</div>
</div>

<div className="max-w-3xl mx-auto mt-6 text-center">
<p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed mb-4">
        Auditors look for holes where invoices lack bank proofs or descriptions lack mission ties. {APP_NAME} enforces 9 attributes before an expense can enter the filing packet.
      </p>
<div className="flex flex-wrap justify-center gap-2">
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Verified Payee</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Contract Period</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Line-Item Match</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Reconciled Amount</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Bank Account</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Vendor Invoice</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Proof of Payment</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Program Justification</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Audit Seal</span>
</div>
</div>

</div>
</section>
<section className="py-24 bg-lp-surface" data-purpose="solution-section" id="system-features">
<Reveal>
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
<div className="text-center max-w-3xl mx-auto mb-16">
<div className="inline-flex items-center px-3.5 py-1 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-4">
          Core Engine
        </div>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4">
          Live Category Tracking &amp; Packet Generation
        </h2>
<p className="text-base sm:text-lg text-on-surface-variant">
          Continuous contract compliance with deterministic document outputs that reviewers accept without pushback.
        </p>
</div>

<div className="glass-tile bg-gradient-to-br from-lp-surface-container/70 to-lp-surface-container-high/70 backdrop-blur-xl border-2 border-primary/45 rounded-3xl p-6 sm:p-10 mb-12 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
<div className="lg:col-span-5 space-y-4">
<div className="w-12 h-12 rounded-2xl bg-primary/75 backdrop-blur-md text-white flex items-center justify-center shadow-lg shadow-primary/30 ring-1 ring-inset ring-white/40 border-2 border-primary/15">
<svg className="w-6 h-6 text-primary-fixed" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
</div>
<h3 className="text-2xl sm:text-3xl font-semibold text-on-surface font-lp-serif">Proactive Category Depletion Tracking</h3>
<p className="text-on-surface-variant leading-relaxed text-xs sm:text-sm">
              Know the exact balance remaining across each line item before approving purchase orders. Automatic thresholds warn you at 80% and 95% depletion to prevent accidental unallowable cost overruns.
            </p>
<div className="pt-2 space-y-2 text-xs">
<div className="flex items-center gap-2 text-on-surface font-medium">
<svg className="w-4 h-4 text-secondary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" fillRule="evenodd"></path></svg>
                Personnel, Supplies, Travel, Participant Support, and Indirect
              </div>
<div className="flex items-center gap-2 text-on-surface font-medium">
<svg className="w-4 h-4 text-secondary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" fillRule="evenodd"></path></svg>
                Calculates opening balances carryover from prior month auto-magically
              </div>
</div>
</div>

<div className="glass-tile lg:col-span-7 bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-2xl p-6 border-2 border-primary/45 shadow-warm-glow ring-1 ring-inset ring-white/30">
<div className="flex items-center justify-between pb-4 border-b border-outline-variant/40">
<div>
<span className="text-xs text-on-surface-variant font-medium">Current Grant Fiscal Year (Month 2 of 12)</span>
<div className="text-2xl font-semibold text-on-surface font-lp-serif mt-0.5">$25,000.00 <span className="text-xs font-normal text-on-surface-variant font-lp-sans">spent of $500,000.00</span></div>
</div>
<span className="px-3 py-1 rounded-full bg-secondary-container text-[#002113] font-semibold text-xs">All 5 Lines In Good Standing</span>
</div>
<div className="mt-5 space-y-3.5">
<div>
<div className="flex justify-between text-xs mb-1">
<span className="font-semibold text-on-surface">Personnel &amp; Salaries</span>
<span className="font-mono text-on-surface-variant">$15,000 / $350,000 (4.3%) • $335,000 Remaining</span>
</div>
<div className="w-full bg-lp-surface-container-highest rounded-full h-2 overflow-hidden"><div className="bg-primary h-2 rounded-full" style={{ width: "4.3%" }}></div></div>
</div>
<div>
<div className="flex justify-between text-xs mb-1">
<span className="font-semibold text-on-surface">Operations &amp; Supplies</span>
<span className="font-mono text-on-surface-variant">$6,000 / $90,000 (6.7%) • $84,000 Remaining</span>
</div>
<div className="w-full bg-lp-surface-container-highest rounded-full h-2 overflow-hidden"><div className="bg-primary h-2 rounded-full" style={{ width: "6.7%" }}></div></div>
</div>
<div>
<div className="flex justify-between text-xs mb-1">
<span className="font-semibold text-on-surface">Participant Support &amp; Travel</span>
<span className="font-mono text-on-surface-variant">$4,000 / $60,000 (6.7%) • $56,000 Remaining</span>
</div>
<div className="w-full bg-lp-surface-container-highest rounded-full h-2 overflow-hidden"><div className="bg-primary h-2 rounded-full" style={{ width: "6.7%" }}></div></div>
</div>
</div>
</div>
</div>
</div>

<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-6 border-2 border-primary/45 shadow-warm-card hover:shadow-warm-card-hover ring-1 ring-inset ring-white/30">
<div className="w-10 h-10 rounded-xl bg-primary-fixed/75 backdrop-blur-md text-primary flex items-center justify-center mb-4 ring-1 ring-inset ring-white/30 border border-primary/12">
<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
</div>
<h4 className="text-lg font-semibold text-on-surface font-lp-serif mb-1">Official Word Cover Sheets</h4>
<p className="text-xs text-on-surface-variant mb-4 leading-relaxed">
            Exports directly to Microsoft Word (.docx) with formatted signature lines, funder contract headers, and category tables ready for officer sign-off.
          </p>
<div className="bg-lp-surface-container/60 backdrop-blur-md rounded-xl p-3 border border-primary/15 text-[11px] font-mono text-on-surface-variant flex items-center justify-between">
<span className="">DocuSign Signature Ready</span>
<span className="text-secondary font-semibold">Word .docx</span>
</div>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-6 border-2 border-primary/45 shadow-warm-card hover:shadow-warm-card-hover ring-1 ring-inset ring-white/30">
<div className="w-10 h-10 rounded-xl bg-secondary-container/75 backdrop-blur-md text-secondary flex items-center justify-center mb-4 ring-1 ring-inset ring-white/30 border border-primary/12">
<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 10h18M3 14h18m-9-4v8m-7 4h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
</div>
<h4 className="text-lg font-semibold text-on-surface font-lp-serif mb-1">Formula-Verified Excel Summaries</h4>
<p className="text-xs text-on-surface-variant mb-4 leading-relaxed">
            Live formula links protect contract totals. Eliminates formula copy-paste errors that trigger immediate desk rejection from city grant reviewers.
          </p>
<div className="bg-lp-surface-container/60 backdrop-blur-md rounded-xl p-3 border border-primary/15 text-[11px] font-mono text-on-surface-variant flex items-center justify-between">
<span className="">Formula-Verified Totals</span>
<span className="text-secondary font-semibold">Excel .xlsx</span>
</div>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-6 border-2 border-primary/45 shadow-warm-card hover:shadow-warm-card-hover ring-1 ring-inset ring-white/30">
<div className="w-10 h-10 rounded-xl bg-brand-100/75 backdrop-blur-md text-brand-800 flex items-center justify-center mb-4 ring-1 ring-inset ring-white/30 border border-primary/12">
<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
</div>
<h4 className="text-lg font-semibold text-on-surface font-lp-serif mb-1">Merged &lt;25MB Filing PDF</h4>
<p className="text-xs text-on-surface-variant mb-4 leading-relaxed">
            Merges cover sheets, contract summaries, and receipt attachments into one paginated PDF file with automated ladder compression to stay under upload limits.
          </p>
<div className="bg-lp-surface-container/60 backdrop-blur-md rounded-xl p-3 border border-primary/15 text-[11px] font-mono text-on-surface-variant flex items-center justify-between">
<span className="">Merged_Packet_Safe.pdf</span>
<span className="text-secondary font-semibold">&lt; 25MB Enforced</span>
</div>
</div>
</div>
</div>
</Reveal>
</section>
<section className="py-24 bg-gradient-to-b from-lp-surface-container-low to-lp-surface border-y border-outline-variant/40" data-purpose="ai-feature-section" id="ai-narratives">
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
<div className="max-w-4xl mx-auto text-center mb-16">
<div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary text-white text-xs font-semibold uppercase tracking-wider mb-4 shadow-sm">
<span className="w-2 h-2 rounded-full bg-primary-fixed animate-ping"></span> Tier 2 Enhancement
        </div>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4">
          Automated AI Monthly Executive &amp; Funder Summaries
        </h2>
<p className="text-base sm:text-lg text-on-surface-variant leading-relaxed">
          Executive Directors spend entire weekends writing narrative memorandums explaining line-item numbers. Our AI synthesizes your validated ledger into polished, funder-grade programmatic prose in 10 seconds.
        </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl border-2 border-primary/45 rounded-3xl p-6 sm:p-10 shadow-warm-glow ring-1 ring-inset ring-white/30">
<div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">

<div className="lg:col-span-5 space-y-4">
<h3 className="text-2xl font-semibold text-on-surface font-lp-serif">What AI Summaries Deliver:</h3>
<ul className="space-y-3.5 text-xs sm:text-sm text-on-surface-variant">
<li className="flex items-start gap-3">
<div className="w-5 h-5 rounded-full bg-secondary-container text-secondary flex items-center justify-center font-semibold text-xs mt-0.5 flex-shrink-0">✓</div>
<span className=""><strong>Programmatic Milestone Synthesis</strong>: Translates line-item charges (van rentals, catering, training stipends) into cohesive impact statements for city monitors.</span>
</li>
<li className="flex items-start gap-3">
<div className="w-5 h-5 rounded-full bg-secondary-container text-secondary flex items-center justify-center font-semibold text-xs mt-0.5 flex-shrink-0">✓</div>
<span className=""><strong>Variance &amp; Anomaly Justification</strong>: Automatically generates professional rationale notes when a category fluctuates compared to prior months.</span>
</li>
<li className="flex items-start gap-3">
<div className="w-5 h-5 rounded-full bg-secondary-container text-secondary flex items-center justify-center font-semibold text-xs mt-0.5 flex-shrink-0">✓</div>
<span className=""><strong>Board &amp; Donor Ready</strong>: Exports one-page executive briefings tailored for Board of Directors and philanthropic funders with zero rewrite needed.</span>
</li>
</ul>
<div className="pt-2">
<span className="text-xs text-primary font-semibold italic">Included in the Multi-Contract &amp; AI Tier ($497/mo)</span>
</div>
</div>

<div className="glass-tile lg:col-span-7 bg-lp-surface-container-low/60 backdrop-blur-lg rounded-2xl p-6 border-2 border-primary/25 font-lp-sans shadow-xs ring-1 ring-inset ring-white/25">
<div className="flex items-center justify-between pb-3 border-b border-outline-variant/30 mb-4">
<div className="flex items-center gap-2">
<span className="w-2.5 h-2.5 rounded-full bg-secondary"></span>
<span className="text-xs font-semibold text-on-surface uppercase tracking-wider font-mono">Generated Funder Narrative Memo</span>
</div>
<span className="text-[11px] font-mono text-primary font-semibold bg-primary-fixed/40 px-2.5 py-0.5 rounded-full">AI Output • Ready to Insert</span>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/70 backdrop-blur-md rounded-xl p-4 sm:p-5 border-2 border-primary/15 ring-1 ring-inset ring-white/25 space-y-3 text-xs leading-relaxed text-on-surface">
<p className="font-lp-serif italic text-primary-container text-sm">
                &quot;Monthly Programmatic Performance &amp; Fiscal Summary: February 2026&quot;
              </p>
<p className="">
                During the reporting period of February 2026, grant funds directly supported <strong>four intensive conflict resolution community pop-ups</strong> throughout the downtown corridor, reaching 84 at-risk young adults.
              </p>
<p className="">
                Expenditures totaled <strong>$25,000.00</strong> across three authorized categories: $15,000.00 in personnel wages for 4 dedicated outreach coordinators; $6,000.00 in supplies for workshop materials; and $4,000.00 in participant support and round-trip transport.
              </p>
<div className="glass-tile p-2.5 rounded-lg bg-brand-50/70 backdrop-blur-md border border-brand-200/40 text-brand-950 text-[11px]">
<strong>Variance Note:</strong> Participant transportation rose by 12% due to increased engagement at the west-side facility; total grant burn remains 4.8% below initial projection with zero unallowable costs.
              </div>
</div>
</div>
</div>
</div>
</div>
</section>
<section className="py-24 bg-lp-surface" data-purpose="audit-readiness-section" id="audit-readiness">
<Reveal>
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
<div className="text-center max-w-3xl mx-auto mb-16">
<div className="inline-flex items-center px-3.5 py-1 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-4">
          Audit Defensibility
        </div>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4">
          Built for the Day the Auditor Knocks
        </h2>
<p className="text-base sm:text-lg text-on-surface-variant">
          Grant compliance isn&apos;t about looking busy; it&apos;s about bulletproof traceability that stands up to city inspectors, OIG monitors, and Single Audit standards.
        </p>
</div>
<div className="grid grid-cols-1 md:grid-cols-4 gap-6">
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-9 h-9 rounded-xl bg-brand-100/75 backdrop-blur-md text-primary ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-3">Ø</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Zero Reconstructed Receipts</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
            Eliminates guesswork 9 months later. Every document was sealed at transaction time, not recreated before an audit.
          </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-9 h-9 rounded-xl bg-secondary-container/75 backdrop-blur-md text-secondary ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-3">√</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Deterministic Gates</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
            The software physically prevents staff from generating monthly packets until every single expense has dual proof attached.
          </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-9 h-9 rounded-xl bg-primary-fixed/75 backdrop-blur-md text-primary ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-3">∞</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Permanent Audit Trail</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
            Every change, category assignment, and upload is timestamped and cryptographically logged for 7-year record retention.
          </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-9 h-9 rounded-xl bg-terracotta-100/75 backdrop-blur-md text-terracotta-700 ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-3">§</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Filed Against Your Own Budget</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
            Every expense is categorized against your organization&apos;s own approved contract line items, not a generic bucket a reviewer has to reinterpret.
          </p>
</div>
</div>
</div>
</Reveal>
</section>
<section className="py-24 bg-lp-surface-container-low border-t border-outline-variant/40" data-purpose="origin-section" id="origin">
<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-left">
<div className="text-center mb-12">
<div className="inline-flex items-center px-3.5 py-1 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-3">
          Our Origin
        </div>
<h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4">
          Born in Detroit with Team Pursuit Global
        </h2>
<p className="text-sm sm:text-base text-on-surface-variant max-w-xl mx-auto">
          {APP_NAME} wasn&apos;t conceived in Silicon Valley. It was built shoulder-to-shoulder with frontline violence intervention workers.
        </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-8 sm:p-12 border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30 space-y-6 text-sm sm:text-base text-on-surface-variant leading-relaxed">
<p className="">
          In Detroit, community organizations like <strong>Team Pursuit Global</strong> do life-saving work every day on the ground, mediating disputes, conducting safe passage patrols for youth, and mentoring young people in high-risk neighborhoods.
        </p>
<p className="">
          Yet every month, the same nightmare occurred: executive staff and frontline outreach leaders were pulled away from the streets for <strong>two to three full days</strong>. They were buried under shoeboxes of faded gas receipts, mismatched credit card statements, and fragile Excel sheets where a single broken formula would delay six-figure municipal reimbursements for weeks.
        </p>
<blockquote className="pl-5 border-l-4 border-primary italic font-lp-serif text-base sm:text-lg text-on-surface my-6">
          &quot;We watched brilliant community heroes spend 20% of their lives fighting Word tables and PDF merge errors. We built {APP_NAME} to eliminate the paperwork hostage situation.&quot;
        </blockquote>
<p className="">
          By creating a single unified record where receipts are attached at the moment of payment and monthly submittals are generated with one click, {APP_NAME} turned that 3-day administrative crisis into a calm 30-minute formality.
        </p>
</div>
</div>
</section>
<section className="py-24 bg-lp-surface" data-purpose="audience-section" id="who-its-for">
<Reveal>
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
<div className="text-center max-w-3xl mx-auto mb-16">
<div className="inline-flex items-center px-3.5 py-1 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-4">
          Target Audience
        </div>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4">
          Designed for Grant Subrecipients
        </h2>
<p className="text-base text-on-surface-variant">
          Purpose-built for teams that must account for every municipal, state, and philanthropic dollar.
        </p>
</div>
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-10 h-10 rounded-xl bg-primary-fixed/75 backdrop-blur-md text-primary ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-4">01</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">CVI &amp; Frontline Nonprofits</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
            Community Violence Intervention teams, youth programs, and grassroots groups with intense field spending.
          </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-10 h-10 rounded-xl bg-secondary-container/75 backdrop-blur-md text-secondary ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-4">02</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Executive Directors</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
            Leaders who need absolute peace of mind before signing monthly funder certifications and cover sheets.
          </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-10 h-10 rounded-xl bg-brand-100/75 backdrop-blur-md text-brand-800 ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-4">03</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Finance &amp; Grant Managers</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
            Operations teams responsible for keeping budgets balanced and filing packages submitted before deadline.
          </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-10 h-10 rounded-xl bg-terracotta-100/75 backdrop-blur-md text-terracotta-700 ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-4">04</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Fiscal Sponsors &amp; Fiduciaries</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
            Fiduciary sponsors managing multiple subgrantees who need uniform compliance without endless back-and-forth.
          </p>
</div>
</div>
</div>
</Reveal>
</section>
<section className="py-24 bg-lp-surface-container-low border-y border-outline-variant/40" data-purpose="pricing-section" id="pricing">
<Reveal>
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
<div className="text-center max-w-3xl mx-auto mb-16">
<div className="inline-flex items-center px-3.5 py-1 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-3">
          Transparent Pricing
        </div>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4">
          Predictable Licensing for Grant-Funded Teams
        </h2>
<p className="text-base text-on-surface-variant">
          Allowable administrative expense under most municipal and federal grant budgets.
        </p>
</div>
<div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">

<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-8 border-2 border-primary/45 shadow-warm-card hover:shadow-warm-card-hover flex flex-col justify-between ring-1 ring-inset ring-white/30">
<div>
<div className="flex justify-between items-center mb-4">
<h3 className="text-2xl font-semibold text-on-surface font-lp-serif">Reconciliation</h3>
<span className="text-xs font-semibold px-3 py-1 rounded-full bg-lp-surface-container text-on-surface-variant border border-outline-variant/40">
                Single Contract
              </span>
</div>
<div className="mb-6">
<div className="flex items-baseline gap-2">
<span className="text-4xl sm:text-5xl font-semibold text-on-surface font-lp-serif">$297</span>
<span className="text-sm font-medium text-on-surface-variant">/ month</span>
</div>
<span className="text-xs text-on-surface-variant font-medium mt-1 block">Full core ledger &amp; packet generation</span>
</div>
<p className="text-xs text-on-surface-variant mb-6 leading-relaxed">
              Designed for organizations managing one dedicated municipal or state grant contract seeking to replace manual spreadsheets.
            </p>
<ul className="space-y-3 text-xs text-on-surface mb-8">
<li className="flex items-center gap-2.5">
<svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fillRule="evenodd"></path></svg>
                Complete 9-item transaction capture &amp; validation
              </li>
<li className="flex items-center gap-2.5">
<svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fillRule="evenodd"></path></svg>
                Hard documentation gate (blocks missing proof)
              </li>
<li className="flex items-center gap-2.5">
<svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fillRule="evenodd"></path></svg>
                Word cover sheet &amp; Excel sub-ledger generator
              </li>
<li className="flex items-center gap-2.5">
<svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fillRule="evenodd"></path></svg>
                Automated merged &lt;25MB filing PDF compiler
              </li>
<li className="flex items-center gap-2.5">
<svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fillRule="evenodd"></path></svg>
                Live category budget depletion alerts
              </li>
<li className="flex items-center gap-2.5">
<svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fillRule="evenodd"></path></svg>
                Standard email onboarding &amp; support
              </li>
</ul>
</div>
<a className="glass-btn glass-btn-light w-full py-3.5 rounded-xl text-center text-xs sm:text-sm font-semibold" href="#schedule-walkthrough">
            Get Started with Reconciliation
          </a>
</div>

<div className="glass-tile relative bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-8 pt-12 border-2 border-primary/70 shadow-warm-glow flex flex-col justify-between ring-1 ring-inset ring-white/20">
<div className="absolute top-4 right-6 z-[2] px-3.5 py-0.5 rounded-full bg-primary text-white font-semibold text-[11px] uppercase tracking-wider shadow-sm">
            Recommended for Busy Directors
          </div>
<div>
<div className="flex justify-between items-center mb-4">
<h3 className="text-2xl font-semibold text-on-surface font-lp-serif">Reconciliation + AI</h3>
<span className="text-xs font-semibold px-3 py-1 rounded-full bg-brand-100 text-brand-900 border border-brand-200">
                All Features + AI
              </span>
</div>
<div className="mb-6">
<div className="flex items-baseline gap-2">
<span className="text-4xl sm:text-5xl font-semibold text-on-surface font-lp-serif">$497</span>
<span className="text-sm font-medium text-on-surface-variant">/ month</span>
</div>
<span className="text-xs text-primary font-semibold mt-1 block">Full Suite + Executive AI Narrative Generator</span>
</div>
<p className="text-xs text-on-surface-variant mb-6 leading-relaxed">
              For teams requiring fast executive reporting, donor narratives, multi-category insights, and AI programmatic drafts.
            </p>
<ul className="space-y-3 text-xs text-on-surface mb-8">
<li className="flex items-center gap-2.5 font-semibold text-primary">
<svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fillRule="evenodd"></path></svg>
                Everything in Reconciliation Package
              </li>
<li className="flex items-center gap-2.5">
<svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fillRule="evenodd"></path></svg>
                Automated AI Monthly Executive &amp; Funder Summaries
              </li>
<li className="flex items-center gap-2.5">
<svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fillRule="evenodd"></path></svg>
                Programmatic narrative draft generator for city packets
              </li>
<li className="flex items-center gap-2.5">
<svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fillRule="evenodd"></path></svg>
                Anomaly detection &amp; budget variance justification notes
              </li>
<li className="flex items-center gap-2.5">
<svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fillRule="evenodd"></path></svg>
                Custom grant contract template customization
              </li>
<li className="flex items-center gap-2.5">
<svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fillRule="evenodd"></path></svg>
                Priority phone &amp; video onboarding support
              </li>
</ul>
</div>
<a
  className="glass-btn glass-btn-primary inline-flex w-full items-center justify-center gap-2 py-3.5 rounded-xl text-center text-xs sm:text-sm font-semibold"
  href="#schedule-walkthrough"
  style={{ background: "color-mix(in srgb, var(--color-brand-900) 90%, transparent)" }}
>
            <span>Start with Reconciliation + AI</span>
            <span className="glass-btn-arrow">
              <svg className="w-3.5 h-3.5 -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3"></path></svg>
            </span>
          </a>
</div>
</div>
</div>
</Reveal>
</section>
<section className="py-24 bg-lp-surface" data-purpose="faq-section" id="faq">
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{
    __html: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: `Does ${APP_NAME} replace our existing Excel spreadsheets?`,
          acceptedAnswer: {
            "@type": "Answer",
            text: `Yes. ${APP_NAME} replaces manual spreadsheet reconciliation with a single ledger where every expense is captured once, with its documentation, at the moment it happens. There's no more retyping totals across separate Word and Excel files.`,
          },
        },
        {
          "@type": "Question",
          name: "What happens if an expense is missing a receipt or bank proof?",
          acceptedAnswer: {
            "@type": "Answer",
            text: `${APP_NAME}'s hard documentation gate physically prevents staff from generating a monthly packet until every expense has both an itemized receipt and proof of payment attached, so incomplete expenses can't slip through to filing.`,
          },
        },
        {
          "@type": "Question",
          name: `Can ${APP_NAME} handle multiple grant contracts at once?`,
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. The Reconciliation + AI plan ($497/month) supports multiple contracts with custom grant contract template customization, on top of everything in the single-contract Reconciliation plan ($297/month).",
          },
        },
        {
          "@type": "Question",
          name: "How long does it take to generate a month-end filing packet?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "One click compiles the official Word cover sheet, Excel sub-ledger, and a merged filing PDF under 25MB. Team Pursuit Global in Detroit went from a 3-day manual reconciliation ordeal to a 30-minute formality.",
          },
        },
        {
          "@type": "Question",
          name: "How long are our records retained, and is the audit trail tamper-proof?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Every change, category assignment, and upload is timestamped and cryptographically logged for 7-year record retention, with a tamper-evident audit seal locking each record against post-filing alterations.",
          },
        },
      ],
    }).replace(/</g, "\\u003c"),
  }}
/>
<div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
<div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-start">
<div className="lg:col-span-4">
<div className="inline-flex items-center px-3.5 py-1 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-4">
          Common Questions
        </div>
<h2 className="text-6xl sm:text-7xl font-semibold tracking-tight text-on-surface font-lp-serif leading-none mb-4">
          FAQs
        </h2>
<p className="text-base text-on-surface-variant max-w-xs">
          Straight answers for grant managers evaluating {APP_NAME} for their team.
        </p>
</div>
<div className="lg:col-span-8 flex flex-col gap-3">
{FAQS.map((faq, index) => {
  const isOpen = openFaq === index;
  return (
    <div
      key={faq.question}
      className={
        isOpen
          ? "bg-lp-surface-container-lowest border border-primary/30 rounded-2xl shadow-warm-card px-6 py-5 transition-[background-color,border-color,box-shadow,transform] duration-300 ease-out"
          : "bg-lp-surface-container-low rounded-2xl px-6 py-4 transition-[background-color,border-color,box-shadow,transform] duration-300 ease-out hover:bg-lp-surface-container hover:-translate-y-0.5"
      }
    >
      <button
        type="button"
        className="w-full flex items-center justify-between gap-4 text-left cursor-pointer"
        aria-expanded={isOpen}
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
              ? "flex-shrink-0 w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center text-lg leading-none rotate-45 transition-transform transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
              : "flex-shrink-0 w-7 h-7 rounded-full bg-lp-surface-container text-on-surface-variant flex items-center justify-center text-lg leading-none rotate-0 transition-transform transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          }
        >
          +
        </span>
      </button>
      <div
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
</div>
</div>
</section>
<section className="relative py-20 bg-[#201a15] text-white overflow-hidden" data-purpose="cta-banner" id="schedule-walkthrough">

<div className="absolute -top-24 -left-24 w-96 h-96 bg-brand-600/30 rounded-full blur-3xl pointer-events-none"></div>
<div className="absolute -bottom-24 -right-24 w-96 h-96 bg-terracotta-500/25 rounded-full blur-3xl pointer-events-none"></div>
<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight font-lp-serif mb-4 text-white">
        Turn month-end from a scramble into a formality.
      </h2>
<p className="text-primary-fixed-dim text-sm sm:text-base max-w-2xl mx-auto mb-8 leading-relaxed">
        Capture expenses as they happen. Generate a complete, submission-ready packet in minutes when the month closes.
      </p>
<div className="flex flex-wrap items-center justify-center gap-4">
<a className="glass-btn glass-btn-primary inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-sm font-semibold" href="#schedule-walkthrough">
          <span>Schedule a Walkthrough</span>
          <span className="glass-btn-arrow">
              <svg className="w-3.5 h-3.5 -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3"></path></svg>
            </span>
        </a>
<a className="glass-btn glass-btn-dark px-8 py-3.5 rounded-full text-sm font-semibold" href="#origin">
          Talk to Us
        </a>
</div>
</div>
</section>
</main>
<footer className="bg-[#201a15] py-12 text-[#edbca5]/80 text-xs">
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
<div className="flex items-center gap-3 flex-shrink-0">
{/* Same white capsule as the nav: the brown logo would vanish on the dark footer. */}
<div className="flex items-center gap-2 rounded-full bg-white pl-1.5 pr-4 py-1 shadow-sm flex-shrink-0">
<Image src="/brand/stayfunded-mark.png" alt="" width={628} height={570} className="h-7" style={{ width: "auto" }} />
<Image src="/brand/stayfunded-wordmark.png" alt={APP_NAME} width={720} height={84} className="h-[15px]" style={{ width: "auto" }} />
</div>
<span className="hidden lg:inline text-[#edbca5]/80 whitespace-nowrap">• Nonprofit &amp; CVI Grant Reconciliation Engine</span>
</div>
<div className="flex flex-wrap items-center justify-center gap-5">
<a className="hover:text-white transition-colors" href="#problem">Problem</a>
<a className="hover:text-white transition-colors" href="#system-features">Features</a>
<a className="hover:text-white transition-colors" href="#ai-narratives">AI Summaries</a>
<a className="hover:text-white transition-colors" href="#pricing">Pricing</a>
<a className="hover:text-white transition-colors" href="#faq">FAQ</a>
</div>
<div className="text-[#edbca5]/80 flex-shrink-0 text-center md:text-right">© 2026 {APP_NAME}. Built for frontline teams. All rights reserved.</div>
</div>
</footer>
    </>
  );
}
