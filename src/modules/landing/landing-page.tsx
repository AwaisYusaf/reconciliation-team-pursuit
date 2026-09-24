import Image from "next/image";
import Link from "next/link";

import { GRADIENT_TEXT } from "@/src/components/ui/surfaces";
import { APP_NAME } from "@/src/domain/strings";

import { type Faq, FaqList, LandingNav, type NavLink, Reveal } from "./landing-islands";

/** Kept as the name the 5-step flow section already reads. */
const FlowStep = Reveal;

const NAV_LINKS: readonly NavLink[] = [
  { id: "problem", label: "The Problem" },
  { id: "system-features", label: "One System" },
  { id: "ai-narratives", label: "The Story" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
];

const FAQS: readonly Faq[] = [
  {
    question: `What is ${APP_NAME}?`,
    answer:
      `${APP_NAME} is a funding accountability and readiness platform. It helps organizations track, document, and stay compliant with the funding they receive throughout the funding period, not just at reconciliation. Budgets, expenses, documentation, program activity, and funding requirements live in one connected system, so the details are handled while the work is happening.`,
  },
  {
    question: "What is the difference between reconciliation and readiness?",
    answer:
      "Reconciliation is something you do. Readiness is something you maintain. Reconciliation is an important part of the process, but it isn't the whole process. A missing receipt, an undocumented expense, or an uncaptured program activity only becomes a problem later, when the books need to close, a report is due, or a funder asks. Readiness means those details were already handled.",
  },
  {
    question: `Does ${APP_NAME} replace our accountant or accounting software?`,
    answer:
      `No. ${APP_NAME} isn't designed to replace your accountant, bookkeeper, or accounting software. It fills the operational space around them. Your books may tell you that $4,800 was spent. ${APP_NAME} answers which funding source paid for it, which budget category it belongs to, where the supporting documentation is, what work it supported, whether it has been reconciled, and whether anything is still missing.`,
  },
  {
    question: `Does ${APP_NAME} replace our existing Excel spreadsheets?`,
    answer:
      `Yes, for the funding records those spreadsheets are holding together. Every expense is captured once, with its documentation, at the moment it happens, so there is no retyping of totals across separate Word and Excel files and no formula that can quietly break between a cover sheet and a sub-ledger.`,
  },
  {
    question: "What is Ready Alerts?",
    answer:
      `Ready Alerts\u2122 identifies missing documentation, incomplete records, approaching requirements, and items that need attention, while there is still time to handle them. It is how ${APP_NAME} surfaces a gap in the month it happens rather than in the week a report is due.`,
  },
  {
    question: "What is Ready Check?",
    answer:
      "Ready Check\u2122 reviews your funding records before reconciliation, reporting, monitoring, or an audit, so you can see what is complete and what still needs attention before anyone outside the organization looks at it.",
  },
  {
    question: "What is Funding Trail?",
    answer:
      "Funding Trail\u2122 follows the connection from funding to expense to documentation to reconciliation. It answers where a dollar came from, what it paid for, what proves it, and what work it supported, as one continuous record rather than four separate lookups.",
  },
  {
    question: "How does the AI Monthly Summary work?",
    answer:
      "As your team documents activity throughout the month, AI organizes that information into a monthly funding and program summary: an ongoing narrative of the work performed, the expenses incurred, and the activity the funding supported. At the end of the month you are not reconstructing the story from memory, because the numbers and the narrative stayed connected.",
  },
  {
    question: "What happens if an expense is missing a receipt or bank proof?",
    answer:
      `Ready Alerts\u2122 flags it while the work is happening, and ${APP_NAME}'s documentation gate prevents a monthly packet from being generated until every expense has both an itemized receipt and proof of payment attached, so incomplete expenses can't slip through to filing.`,
  },
  {
    question: `Can ${APP_NAME} handle multiple grants or funding sources?`,
    answer:
      "Yes. Each funding source keeps its own budget, guidelines, expenses, documentation, and requirements, while leadership keeps visibility across the whole organization. Multiple contracts are supported on the Reconciliation + AI plan ($497/month), on top of everything in the single-contract Reconciliation plan ($297/month).",
  },
  {
    question: "How long does it take to generate a month-end filing packet?",
    answer:
      "One click compiles the official Word cover sheet, Excel sub-ledger, and a merged filing PDF under 25MB. Because expenses arrive already documented and categorized, the packet confirms what is already there instead of rebuilding it. Team Pursuit Global in Detroit went from a 3-day manual ordeal to a 30-minute formality.",
  },
  {
    question: "How long are our records retained, and is the audit trail tamper-proof?",
    answer:
      "Every change, category assignment, and upload is timestamped and cryptographically logged for 7-year record retention, with a tamper-evident audit seal locking each record against post-filing alterations.",
  },
];

export function LandingPage() {
  return (
    <>
<header className="sticky top-0 z-50 transition-all duration-200 px-4 sm:px-6 py-3">
<div className="surface-dark max-w-3xl mx-auto rounded-full bg-[#38231a] border border-[#5b3a29] shadow-xl shadow-black/40 pl-2.5 sm:pl-3 pr-2.5 sm:pr-3 py-2 flex items-center justify-between">

{/* The full logo's own artwork, laid out side by side: its stacked form (mark over wordmark
    over tagline) would be unreadable at nav height. White so the brown logo reads on the pill. */}
<Link
  className="flex items-center gap-2 rounded-full bg-white pl-1.5 pr-4 py-1 shadow-sm transition-transform hover:scale-[1.02]"
  href="/"
>
<Image src="/brand/stayfunded-mark.png" alt="" width={628} height={570} className="h-7" style={{ width: "auto" }} priority />
<Image src="/brand/stayfunded-wordmark.png" alt={APP_NAME} width={720} height={84} className="h-[15px]" style={{ width: "auto" }} priority />
</Link>

<LandingNav links={NAV_LINKS} />

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
<span className="w-2 h-2 rounded-full bg-brand-700 animate-pulse"></span> Track &middot; Document &middot; Comply
        </div>

{/* One step down at every width. At the old size the two lines ate the top of the hero and
          pushed the buttons under the fold on a laptop, and the headline is a claim, not a
          banner. The `leading` stays tight so the two lines still read as one thought. */}
        <h1 className="text-2xl sm:text-3xl lg:text-3xl xl:text-4xl font-semibold tracking-tight text-on-surface font-lp-serif leading-[1.15] mb-4">
          Getting funded is one thing.{" "}<br /><span className="text-primary italic font-lp-serif">Staying funded means staying ready.<span className="align-super text-[0.28em] not-italic">&trade;</span></span>
</h1>

{/*
          What it is, then what you do with it. The client's paragraph said both three times
          over — expenses, documentation, reconciliation and compliance, then budgets,
          expenses, documentation, reporting, reconciliation and audit readiness, then a
          360-degree view of the same — so it ran six lines under the headline and pushed the
          buttons down the page. Every term here is still the client's own; the restatements
          are what went. `max-w-xl` holds it to roughly two lines beside the screenshot.
        */}
        <p className="text-sm lg:text-base text-on-surface-variant leading-relaxed max-w-xl mb-6">
          {APP_NAME} is an AI powered funding accountability and readiness platform. Track
          expenses, organize documentation, reconcile funding and stay audit ready across the
          whole funding lifecycle.
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
            See how it works
          </a>
</div>
</div>

<div className="relative w-full overflow-hidden">
  <div className="relative w-full aspect-[3944/2564] overflow-hidden">
    
    <div className="absolute z-10 overflow-hidden bg-lp-surface-container-lowest text-left select-none" style={{ top: "9.91%", left: "10.5%", right: "10.55%", bottom: "7.06%" }}>
      <div className="relative pt-3 px-3 pb-1.5 sm:pt-4 sm:px-4 sm:pb-2 lg:pt-5 lg:px-5 lg:pb-2.5 bg-lp-surface-container-lowest h-full flex flex-col select-none">


  <div className="border-b border-outline-variant/50 pb-1 sm:pb-1.5 mb-1.5 sm:mb-2">
    {/* The app's own nav: one dark pill, the current tab reversed out of it in white. */}
    <nav className="flex items-center gap-0.5 overflow-hidden rounded-full bg-accent-dark px-1 py-0.5 text-[6px] sm:text-[7px] font-medium">
        <span className="rounded-full px-1.5 py-0.5 whitespace-nowrap bg-lp-surface-container-lowest text-primary font-semibold">Dashboard</span>
        <span className="rounded-full px-1.5 py-0.5 whitespace-nowrap text-lp-surface-container-lowest/75">Add Expense</span>
        <span className="rounded-full px-1.5 py-0.5 whitespace-nowrap text-lp-surface-container-lowest/75">Expenses</span>
        <span className="rounded-full px-1.5 py-0.5 whitespace-nowrap text-lp-surface-container-lowest/75">Cover Sheets</span>
        <span className="rounded-full px-1.5 py-0.5 whitespace-nowrap text-lp-surface-container-lowest/75">Recurring</span>
        <span className="rounded-full px-1.5 py-0.5 whitespace-nowrap text-lp-surface-container-lowest/75">Month-End Packet</span>
        <span className="rounded-full px-1.5 py-0.5 whitespace-nowrap text-lp-surface-container-lowest/75">Contract Summary</span>
        <span className="rounded-full px-1.5 py-0.5 whitespace-nowrap text-lp-surface-container-lowest/75">Line Items</span>
        <span className="rounded-full px-1.5 py-0.5 whitespace-nowrap text-lp-surface-container-lowest/75">Settings</span>
    </nav>
  </div>

  <div className="mb-1.5 sm:mb-2">
    <p className="text-[6px] sm:text-[7px] text-on-surface-variant font-normal leading-tight">Budget status for August 2026.</p>
    <p className="text-[10px] sm:text-xs lg:text-sm font-bold text-on-surface tracking-tight leading-none mt-0.5">Welcome back, Team!</p>
  </div>

  {/* The dashboard's hero row: the position and its year on the left, the month's own
      figures on the right, with one filled tile. */}
  <div className="grid grid-cols-[1.5fr_1fr] gap-1 sm:gap-1.5 mb-1.5 sm:mb-2">
    <div className="border border-outline-variant/50 rounded-lg p-1 sm:p-1.5 flex flex-col bg-[linear-gradient(to_top,var(--color-hero-wash)_0%,var(--color-surface)_75%)]">
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[6px] sm:text-[7px] font-bold text-on-surface">Total remaining</span>
        <span className="text-[5px] sm:text-[6px] font-bold text-on-surface-variant bg-lp-surface-container rounded-full px-1 py-0.5">4% committed</span>
      </div>
      <div className="text-[11px] sm:text-sm lg:text-base font-bold text-on-surface tracking-tight leading-none mt-0.5">$576,472<span className="text-[7px] sm:text-[9px] text-on-surface-variant">.00</span></div>
      <span className="text-[5px] sm:text-[6px] font-bold uppercase tracking-wider text-on-surface-variant mt-1">Spent each month</span>
      <div className="flex items-end justify-between h-6 sm:h-8 mt-0.5"><span className="w-[3px] sm:w-1 rounded-[1px] bg-accent/45" style={{ height: "18%" }} /><span className="w-[3px] sm:w-1 rounded-[1px] bg-accent/45" style={{ height: "62%" }} /><span className="w-[3px] sm:w-1 rounded-[1px] bg-accent/45" style={{ height: "22%" }} /><span className="w-[3px] sm:w-1 rounded-[1px] bg-accent/45" style={{ height: "30%" }} /><span className="w-[3px] sm:w-1 rounded-[1px] bg-accent/45" style={{ height: "12%" }} /><span className="w-[3px] sm:w-1 rounded-[1px] bg-accent/45" style={{ height: "48%" }} /><span className="w-[3px] sm:w-1 rounded-[1px] bg-accent" style={{ height: "26%" }} /><span className="w-[3px] sm:w-1 rounded-[1px] bg-accent/45" style={{ height: "8%" }} /><span className="w-[3px] sm:w-1 rounded-[1px] bg-accent/45" style={{ height: "14%" }} /><span className="w-[3px] sm:w-1 rounded-[1px] bg-accent/45" style={{ height: "10%" }} /><span className="w-[3px] sm:w-1 rounded-[1px] bg-accent/45" style={{ height: "16%" }} /><span className="w-[3px] sm:w-1 rounded-[1px] bg-accent/45" style={{ height: "9%" }} /></div>
      <div className="flex justify-between text-[4px] sm:text-[5px] mt-0.5"><span className="text-on-surface-variant/70">Jan</span><span className="text-on-surface-variant/70">Feb</span><span className="text-on-surface-variant/70">Mar</span><span className="text-on-surface-variant/70">Apr</span><span className="text-on-surface-variant/70">May</span><span className="text-on-surface-variant/70">Jun</span><span className="text-on-surface-variant/70">Jul</span><span className="text-on-surface font-bold">Aug</span><span className="text-on-surface-variant/70">Sep</span><span className="text-on-surface-variant/70">Oct</span><span className="text-on-surface-variant/70">Nov</span><span className="text-on-surface-variant/70">Dec</span></div>
    </div>

    <div className="grid grid-cols-2 gap-1 content-start">
      <div className="rounded-lg p-1 text-lp-surface-container-lowest bg-[linear-gradient(135deg,var(--color-hero-from)_0%,var(--color-hero-to)_100%)]">
        <div className="text-[5px] sm:text-[6px] font-bold uppercase tracking-wider opacity-75">Spent this month</div>
        <div className="text-[7px] sm:text-[9px] font-bold leading-tight mt-0.5">$22,220.00</div>
      </div>
      <div className="rounded-lg p-1 bg-lp-surface-container-lowest border border-outline-variant/50">
        <div className="text-[5px] sm:text-[6px] font-bold uppercase tracking-wider text-on-surface-variant">Expenses in Aug</div>
        <div className="text-[7px] sm:text-[9px] font-bold text-on-surface leading-tight mt-0.5">14</div>
      </div>
      <div className="rounded-lg p-1 bg-lp-surface-container-lowest border border-outline-variant/50">
        <div className="text-[5px] sm:text-[6px] font-bold uppercase tracking-wider text-on-surface-variant">Approved budget</div>
        <div className="text-[7px] sm:text-[9px] font-bold text-on-surface leading-tight mt-0.5">$598,692.00</div>
      </div>
      <div className="rounded-lg p-1 bg-lp-surface-container-lowest border border-outline-variant/50">
        <div className="text-[5px] sm:text-[6px] font-bold uppercase tracking-wider text-on-surface-variant">Missing documents</div>
        <div className="text-[7px] sm:text-[9px] font-bold text-on-surface leading-tight mt-0.5">0</div>
      </div>
    </div>
  </div>

  <div className="mb-1 sm:mb-1.5">
    <p className="text-[9px] sm:text-[11px] lg:text-xs font-semibold text-on-surface font-lp-serif tracking-tight leading-tight">August 2026 on its own</p>
    <p className="text-[6px] sm:text-[8px] text-on-surface-variant leading-snug mt-0.5">Opening balance, what this month spent, and what is left at the end of it. Each month starts where the last one closed.</p>
  </div>

  <div className="bg-lp-surface-container-lowest/70 backdrop-blur-md rounded-lg border border-outline-variant/50 overflow-hidden flex-1 ring-1 ring-inset ring-white/40">
    <table className="w-full text-left text-[6px] sm:text-[8px] lg:text-[9px]">
      <thead>
        <tr className="font-bold uppercase tracking-wider text-lp-surface-container-lowest bg-[linear-gradient(90deg,var(--color-hero-from)_0%,var(--color-hero-to)_100%)]">
          <th className="py-0.5 px-1.5 sm:px-2 font-bold text-left whitespace-nowrap">Line Item</th>
          <th className="py-0.5 px-1.5 sm:px-2 font-bold text-right whitespace-nowrap">Opening Balance</th>
          <th className="py-0.5 px-1.5 sm:px-2 font-bold text-right whitespace-nowrap">Spent In Aug</th>
          <th className="py-0.5 px-1.5 sm:px-2 font-bold text-right whitespace-nowrap">Closing Balance</th>
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
      alt="The Stay Funded 360 dashboard on a laptop, showing the remaining balance, spending by month, and each budget line's opening and closing balance"
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
<span className="">From award to audit, know where your funding stands. Field-tested with <strong className="text-on-surface font-semibold">Team Pursuit Global</strong> in Detroit.</span>
</div>
</div>
</div>
</section>
<section className="py-24 bg-lp-surface-container-low border-y border-outline-variant/40" data-purpose="problem-section" id="problem">
<Reveal>
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
<div className="inline-flex items-center px-3.5 py-1 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-4">
        Don&apos;t wait until reconciliation
      </div>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4 max-w-3xl mx-auto">
        Don&apos;t wait until reconciliation to find out you&apos;re not ready.
      </h2>
<p className="text-base sm:text-lg text-on-surface-variant max-w-2xl mx-auto mb-16">
        And a funding requirement that&apos;s overlooked becomes much more serious when a funder asks for it.
      </p>

<div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">

<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-8 border-2 border-primary/45 shadow-warm-card flex flex-col justify-between ring-1 ring-inset ring-white/30">
<div>
<div className="flex items-center justify-between mb-4">
<div className="w-10 h-10 rounded-xl bg-terracotta-100/75 backdrop-blur-md text-terracotta-700 ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold">
<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
</div>
<span className="text-xs font-semibold font-mono text-tertiary bg-tertiary-container/60 px-2.5 py-1 rounded-full">Due at reconciliation</span>
</div>
<h3 className="text-xl font-semibold text-on-surface font-lp-serif mb-2">A missing receipt</h3>
<p className="text-xs sm:text-sm text-on-surface-variant mb-6 leading-relaxed">
              A missing receipt seems small until reconciliation is due.
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
<span className="text-xs font-semibold font-mono text-amber-800 bg-amber-100 px-2.5 py-1 rounded-full">Due at close</span>
</div>
<h3 className="text-xl font-semibold text-on-surface font-lp-serif mb-2">An undocumented expense</h3>
<p className="text-xs sm:text-sm text-on-surface-variant mb-6 leading-relaxed">
              An undocumented expense becomes a problem when the books need to close.
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
<span className="text-xs font-semibold font-mono text-tertiary bg-tertiary-container/60 px-2.5 py-1 rounded-full">Due at reporting</span>
</div>
<h3 className="text-xl font-semibold text-on-surface font-lp-serif mb-2">An uncaptured activity</h3>
<p className="text-xs sm:text-sm text-on-surface-variant mb-6 leading-relaxed">
              A program activity that wasn&apos;t captured becomes a scramble when it&apos;s time to write the monthly narrative.
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
      "@type": "ItemList",
      name: "Know what needs your attention",
      description:
        "Funding, budgets, expenses, documentation, requirements, and readiness, all in one place.",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "360 Dashboard",
          text: "See funding, budgets, expenses, documentation, requirements, and readiness in one place.",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Ready Alerts\u2122",
          text: "Identify missing documentation, incomplete records, approaching requirements, and items that need attention.",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "Ready Check\u2122",
          text: "Review your funding records before reconciliation, reporting, monitoring, or audit.",
        },
        {
          "@type": "ListItem",
          position: 4,
          name: "AI Monthly Summary",
          text: "Turn monthly expenses and documented program activity into an organized narrative of how funding supported the work.",
        },
        {
          "@type": "ListItem",
          position: 5,
          name: "Funding Trail\u2122",
          text: "Follow the connection from funding to expense to documentation to reconciliation.",
        },
      ],
    }).replace(/</g, "\\u003c"),
  }}
/>
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
<div className="text-center max-w-3xl mx-auto mb-16">
<div className="inline-flex items-center px-3.5 py-1 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-4">
          One connected view
        </div>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4">
          Know what needs your attention
        </h2>
<p className="text-base sm:text-lg text-on-surface-variant">
          Funding, budgets, expenses, documentation, requirements, and readiness, all in one place.
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
<h3 className="text-lg sm:text-xl font-semibold text-on-surface font-lp-serif mb-1.5">360 Dashboard</h3>
<p className="text-sm sm:text-base text-on-surface-variant leading-relaxed mb-2">
              See funding, budgets, expenses, documentation, requirements, and readiness in one place.
            </p>
<span className="text-[10px] font-mono text-secondary font-semibold uppercase tracking-wide">One place</span>
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
<h3 className="text-lg sm:text-xl font-semibold text-on-surface font-lp-serif mb-1.5">Ready Alerts&trade;</h3>
<p className="text-sm sm:text-base text-on-surface-variant leading-relaxed mb-2">
              Identify missing documentation, incomplete records, approaching requirements, and items that need attention.
            </p>
<span className="text-[10px] font-mono text-terracotta-700 font-semibold uppercase tracking-wide">Nothing missed</span>
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
<h3 className="text-lg sm:text-xl font-semibold text-on-surface font-lp-serif mb-1.5">Ready Check&trade;</h3>
<p className="text-sm sm:text-base text-on-surface-variant leading-relaxed mb-2">
              Review your funding records before reconciliation, reporting, monitoring, or audit.
            </p>
<span className="text-[10px] font-mono text-brand-800 font-semibold uppercase tracking-wide">Before it matters</span>
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
<h3 className="text-lg sm:text-xl font-semibold text-on-surface font-lp-serif mb-1.5">AI Monthly Summary</h3>
<p className="text-sm sm:text-base text-on-surface-variant leading-relaxed mb-2">
              Turn monthly expenses and documented program activity into an organized narrative of how funding supported the work.
            </p>
<span className="text-[10px] font-mono text-secondary font-semibold uppercase tracking-wide">Numbers and narrative</span>
</div>
</div>
</FlowStep>

<FlowStep>
<div className="flex gap-5">
<div className="flex flex-col items-center flex-shrink-0">
<div className="w-9 h-9 rounded-full bg-secondary text-white font-semibold text-xs flex items-center justify-center flex-shrink-0">5</div>
</div>
<div className="flex-1">
<h3 className="text-lg sm:text-xl font-semibold text-on-surface font-lp-serif mb-1.5">Funding Trail&trade;</h3>
<p className="text-sm sm:text-base text-on-surface-variant leading-relaxed mb-2">
              Follow the connection from funding to expense to documentation to reconciliation.
            </p>
<span className="text-[10px] font-mono text-secondary font-semibold uppercase tracking-wide">End to end</span>
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
      name: "The Questions Behind a Transaction",
      description:
        `What ${APP_NAME} answers about an expense that the ledger line alone does not.`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Which funding source paid for it?" },
        { "@type": "ListItem", position: 2, name: "Which budget category does it belong to?" },
        { "@type": "ListItem", position: 3, name: "Where is the supporting documentation?" },
        { "@type": "ListItem", position: 4, name: "What work did the expense support?" },
        { "@type": "ListItem", position: 5, name: "Has it been reconciled?" },
        { "@type": "ListItem", position: 6, name: "Is anything still missing?" },
        { "@type": "ListItem", position: 7, name: "Tracked" },
        { "@type": "ListItem", position: 8, name: "Documented" },
        { "@type": "ListItem", position: 9, name: "Compliant" },
      ],
    }).replace(/</g, "\\u003c"),
  }}
/>
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
<div className="text-center max-w-3xl mx-auto mb-16">
<div className="inline-flex items-center px-3.5 py-1 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-4">
          Your accounting system records the transaction
        </div>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4">
          {APP_NAME} helps manage the accountability around it
        </h2>
<p className="text-base sm:text-lg text-on-surface-variant">
          {APP_NAME} isn&apos;t designed to replace your accountant, bookkeeper, or accounting software. It fills the operational space around them. Your books may tell you that $4,800 was spent. {APP_NAME} helps you answer:
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
        That&apos;s why {APP_NAME} is more than an expense tracker. It connects the dollars, the documentation, and the work.
      </p>
<div className="flex flex-wrap justify-center gap-2">
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Which funding source paid for it?</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Which budget category does it belong to?</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Where is the supporting documentation?</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">What work did the expense support?</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Has it been reconciled?</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Is anything still missing?</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Tracked</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Documented</span>
<span className="px-3 py-1.5 rounded-full bg-lp-surface-container-lowest border border-outline-variant/50 text-xs font-medium text-on-surface">Compliant</span>
</div>
</div>

</div>
</section>
<section className="py-24 bg-lp-surface" data-purpose="solution-section" id="system-features">
<Reveal>
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
<div className="text-center max-w-3xl mx-auto mb-16">
<div className="inline-flex items-center px-3.5 py-1 rounded-full bg-lp-surface-container-high border border-outline-variant text-xs font-semibold text-brand-800 mb-4">
          Scattered across seven places
        </div>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4">
          Your funding information is already there. It&apos;s just scattered.
        </h2>
<p className="text-base sm:text-lg text-on-surface-variant">
          The problem isn&apos;t always that the information doesn&apos;t exist. It&apos;s that it exists everywhere: accounting software, spreadsheets, emails, receipts, shared folders, staff members, program records.
        </p>
</div>

<div className="glass-tile bg-gradient-to-br from-lp-surface-container/70 to-lp-surface-container-high/70 backdrop-blur-xl border-2 border-primary/45 rounded-3xl p-6 sm:p-10 mb-12 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
<div className="lg:col-span-5 space-y-4">
<div className="w-12 h-12 rounded-2xl bg-primary/75 backdrop-blur-md text-white flex items-center justify-center shadow-lg shadow-primary/30 ring-1 ring-inset ring-white/40 border-2 border-primary/15">
<svg className="w-6 h-6 text-primary-fixed" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
</div>
<h3 className="text-2xl sm:text-3xl font-semibold text-on-surface font-lp-serif">One connected system</h3>
<p className="text-on-surface-variant leading-relaxed text-xs sm:text-sm">
              Stay Funded 360 brings the accountability behind your funding into one connected system, so your team can manage the details while the work is happening rather than after it.
            </p>
<div className="pt-2 space-y-2 text-xs">
<div className="flex items-center gap-2 text-on-surface font-medium">
<svg className="w-4 h-4 text-secondary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" fillRule="evenodd"></path></svg>
                Accounting software. Spreadsheets. Emails. Receipts. Shared folders. Staff members. Program records.
              </div>
<div className="flex items-center gap-2 text-on-surface font-medium">
<svg className="w-4 h-4 text-secondary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" fillRule="evenodd"></path></svg>
                Every one of them a place a detail can go missing
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
<h4 className="text-lg font-semibold text-on-surface font-lp-serif mb-1">Not when the report is due</h4>
<p className="text-xs text-on-surface-variant mb-4 leading-relaxed">
              Funding requirements get handled while the work is happening, not in the few days before a deadline lands.
          </p>
<div className="bg-lp-surface-container/60 backdrop-blur-md rounded-xl p-3 border border-primary/15 text-[11px] font-mono text-on-surface-variant flex items-center justify-between">
<span className="">Handled as it happens</span>
<span className="text-secondary font-semibold">In the moment</span>
</div>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-6 border-2 border-primary/45 shadow-warm-card hover:shadow-warm-card-hover ring-1 ring-inset ring-white/30">
<div className="w-10 h-10 rounded-xl bg-secondary-container/75 backdrop-blur-md text-secondary flex items-center justify-center mb-4 ring-1 ring-inset ring-white/30 border border-primary/12">
<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 10h18M3 14h18m-9-4v8m-7 4h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
</div>
<h4 className="text-lg font-semibold text-on-surface font-lp-serif mb-1">Not when reconciliation starts</h4>
<p className="text-xs text-on-surface-variant mb-4 leading-relaxed">
              Expenses arrive already documented, categorized, and connected to a funding source, so reconciliation confirms what is already there.
          </p>
<div className="bg-lp-surface-container/60 backdrop-blur-md rounded-xl p-3 border border-primary/15 text-[11px] font-mono text-on-surface-variant flex items-center justify-between">
<span className="">Already documented</span>
<span className="text-secondary font-semibold">Confirm, don&apos;t rebuild</span>
</div>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-6 border-2 border-primary/45 shadow-warm-card hover:shadow-warm-card-hover ring-1 ring-inset ring-white/30">
<div className="w-10 h-10 rounded-xl bg-brand-100/75 backdrop-blur-md text-brand-800 flex items-center justify-center mb-4 ring-1 ring-inset ring-white/30 border border-primary/12">
<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
</div>
<h4 className="text-lg font-semibold text-on-surface font-lp-serif mb-1">Not when the auditor arrives</h4>
<p className="text-xs text-on-surface-variant mb-4 leading-relaxed">
              Records stay ready throughout the funding period, so a monitoring request or an audit isn&apos;t a scramble through old folders.
          </p>
<div className="bg-lp-surface-container/60 backdrop-blur-md rounded-xl p-3 border border-primary/15 text-[11px] font-mono text-on-surface-variant flex items-center justify-between">
<span className="">Ready the whole time</span>
<span className="text-secondary font-semibold">No scramble</span>
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
          Don&apos;t just track the money. Track the story behind it.
        </h2>
{/*
          Four sentences from six, and roughly a third of the characters. The original made its
          point in the first two and then made it three more times: an ongoing narrative of the
          work performed, then not reconstructing from memory, then better records, better
          bookkeeping support, stronger reporting preparation and a clearer picture. Under a
          heading that already says "track the story behind it", the restatements were the
          whole reason this ran eight lines. The client's own terms all survive.
        */}
        <p className="text-base text-on-surface-variant leading-relaxed">
          A financial report tells you what was spent. Funders want to know what it supported.
          {" "}{APP_NAME} connects the two: as your team documents activity through the month, AI
          turns it into a monthly funding and program summary, so at the end of the month you
          are not reconstructing the story from memory.
        </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl border-2 border-primary/45 rounded-3xl p-6 sm:p-10 shadow-warm-glow ring-1 ring-inset ring-white/30">
<div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">

<div className="lg:col-span-5 space-y-4">
<h3 className="text-2xl font-semibold text-on-surface font-lp-serif">The numbers and the narrative stay connected:</h3>
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
          More than reconciliation
        </div>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-on-surface font-lp-serif mb-4">
          It&apos;s 360&deg; funding readiness
        </h2>
<p className="text-base sm:text-lg text-on-surface-variant">
          Reconciliation is an important part of the process. But it isn&apos;t the whole process.
        </p>
</div>
<div className="grid grid-cols-1 md:grid-cols-4 gap-6">
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-9 h-9 rounded-xl bg-brand-100/75 backdrop-blur-md text-primary ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-3">Ø</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Track</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
              Monitor budgets, expenses, funding sources, spending categories, and remaining balances.
          </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-9 h-9 rounded-xl bg-secondary-container/75 backdrop-blur-md text-secondary ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-3">√</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Document</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
              Connect receipts, invoices, approvals, supporting records, and program activity to the expenses they support.
          </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-9 h-9 rounded-xl bg-primary-fixed/75 backdrop-blur-md text-primary ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-3">∞</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Comply</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
              Stay aligned with funding requirements while preparing for reconciliation, reporting, monitoring, and audit.
          </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-9 h-9 rounded-xl bg-terracotta-100/75 backdrop-blur-md text-terracotta-700 ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-3">§</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Multiple grants</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
              Each can maintain its own budget, guidelines, expenses, documentation, and requirements while leadership maintains visibility across the organization.
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
          Reconciliation is something you do. Readiness is something you maintain. That is the difference {APP_NAME} was built to make, for Team Pursuit Global first and for every organization carrying the same load.
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
          Designed for teams that stay ready
        </h2>
<p className="text-base text-on-surface-variant">
          Purpose-built for organizations that must account for the funding they receive, for the whole funding period.
        </p>
</div>
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-10 h-10 rounded-xl bg-primary-fixed/75 backdrop-blur-md text-primary ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-4">01</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Stay bookkeeping ready</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
              Records stay organized and connected as expenses happen, so the books are easier to keep.
          </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-10 h-10 rounded-xl bg-secondary-container/75 backdrop-blur-md text-secondary ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-4">02</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Stay reconciliation ready</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
              Expenses arrive documented and categorized, so reconciliation confirms what is already there.
          </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-10 h-10 rounded-xl bg-brand-100/75 backdrop-blur-md text-brand-800 ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-4">03</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Stay reporting ready</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
              The numbers and the narrative stay connected, so reports don&apos;t start from memory.
          </p>
</div>
<div className="glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl p-6 rounded-2xl border-2 border-primary/45 shadow-warm-card ring-1 ring-inset ring-white/30">
<div className="w-10 h-10 rounded-xl bg-terracotta-100/75 backdrop-blur-md text-terracotta-700 ring-1 ring-inset ring-white/40 border-2 border-primary/15 flex items-center justify-center font-semibold text-sm mb-4">04</div>
<h3 className="text-base font-semibold text-on-surface font-lp-serif mb-2">Stay audit ready</h3>
<p className="text-xs text-on-surface-variant leading-relaxed">
              Documentation, approvals, and funding requirements stay in place, so a monitoring request isn&apos;t a scramble.
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
<div className="absolute top-4 right-6 z-[2] px-3.5 py-0.5 rounded-full bg-[linear-gradient(135deg,var(--color-hero-from)_0%,var(--color-hero-to)_100%)] text-white font-semibold text-[11px] uppercase tracking-wider shadow-sm">
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
<span className={`text-4xl sm:text-5xl font-semibold font-lp-serif ${GRADIENT_TEXT}`}>$497</span>
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
  style={{
    background:
      "linear-gradient(135deg, var(--color-hero-from) 0%, var(--color-hero-to) 100%)",
  }}
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
      mainEntity: FAQS.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
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
<FaqList faqs={FAQS} />
</div>
</div>
</section>
<section className="surface-dark relative py-20 bg-[#201a15] text-white overflow-hidden" data-purpose="cta-banner" id="schedule-walkthrough">

<div className="absolute -top-24 -left-24 w-96 h-96 bg-brand-600/30 rounded-full blur-3xl pointer-events-none"></div>
<div className="absolute -bottom-24 -right-24 w-96 h-96 bg-terracotta-500/25 rounded-full blur-3xl pointer-events-none"></div>
<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight font-lp-serif mb-4 text-white">
        Don&apos;t get ready. Stay ready.
      </h2>
<p className="text-primary-fixed-dim text-sm sm:text-base max-w-2xl mx-auto mb-8 leading-relaxed">
        {APP_NAME}. Track &middot; Document &middot; Comply. 360&deg; funding accountability from award to audit. Because staying funded means staying ready.<span className="align-super text-[0.5em]">&trade;</span>
      </p>
<ul className="flex flex-wrap items-center justify-center gap-2 mb-8">
{["Stay organized", "Stay bookkeeping ready", "Stay reconciliation ready", "Stay reporting ready", "Stay funder ready", "Stay audit ready"].map((line) => (
  <li key={line} className="rounded-full border border-white/20 bg-white/5 px-3.5 py-1.5 text-xs sm:text-sm font-medium text-primary-fixed-dim">{line}</li>
))}
</ul>
<div className="flex flex-wrap items-center justify-center gap-4">
<a className="glass-btn glass-btn-primary inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-sm font-semibold" href="mailto:tech@teampursuit.org?subject=Stay%20Funded%20360%20demo%20request">
          <span>Request a demo</span>
          <span className="glass-btn-arrow">
              <svg className="w-3.5 h-3.5 -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3"></path></svg>
            </span>
        </a>
<a className="glass-btn glass-btn-dark px-8 py-3.5 rounded-full text-sm font-semibold" href="mailto:tech@teampursuit.org?subject=Stay%20Funded%20360%20early%20access">
          Join early access
        </a>
</div>
</div>
</section>
</main>
<footer className="surface-dark bg-[#201a15] py-12 text-[#edbca5]/80 text-xs">
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col lg:flex-row items-center justify-between gap-4 lg:gap-6">
<div className="flex items-center gap-3 flex-shrink-0">
{/* Same white capsule as the nav: the brown logo would vanish on the dark footer. */}
<div className="flex items-center gap-2 rounded-full bg-white pl-1.5 pr-4 py-1 shadow-sm flex-shrink-0">
<Image src="/brand/stayfunded-mark.png" alt="" width={628} height={570} className="h-7" style={{ width: "auto" }} />
<Image src="/brand/stayfunded-wordmark.png" alt={APP_NAME} width={720} height={84} className="h-[15px]" style={{ width: "auto" }} />
</div>
<span className="hidden 2xl:inline text-[#edbca5]/80 whitespace-nowrap">• Funding Accountability &amp; Readiness Platform</span>
</div>
<div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 lg:flex-nowrap lg:whitespace-nowrap">
<a className="hover:text-white transition-colors" href="#problem">The Problem</a>
<a className="hover:text-white transition-colors" href="#system-features">One System</a>
<a className="hover:text-white transition-colors" href="#ai-narratives">The Story</a>
<a className="hover:text-white transition-colors" href="#pricing">Pricing</a>
<a className="hover:text-white transition-colors" href="#faq">FAQ</a>
</div>
<div className="text-[#edbca5]/80 flex-shrink-0 text-center md:text-right">© 2026 {APP_NAME}. Built for frontline teams. All rights reserved.</div>
</div>
</footer>
    </>
  );
}
