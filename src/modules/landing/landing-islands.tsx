"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The landing page's only interactive parts.
 *
 * The page itself is a server component: it is almost entirely static copy, and shipping all
 * 1,300 lines of it as client JavaScript to hydrate three behaviours cost every visitor the
 * download and the hydration for nothing. These four are what needs the browser — a reveal on
 * scroll, the header's scroll-spy, the FAQ accordion and the demo video's player — and the static
 * markup passes into them as children or plain data.
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

/** `0:07` / `1:02`: minutes and seconds, for the player's time readout. */
function clock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const CONTROL =
  "inline-flex items-center justify-center w-11 h-11 rounded-full text-white hover:bg-white/15 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white";

/** A play triangle drawn about the middle of its box, so it sits centred in a circle without a
 *  hand-tuned nudge (its visual weight, not its bounding box, is what is centred). */
const PLAY_PATH = "M9 6.2v11.6a.8.8 0 0 0 1.2.7l9.2-5.8a.8.8 0 0 0 0-1.4l-9.2-5.8A.8.8 0 0 0 9 6.2Z";

/**
 * The product demo: its first frame with a play button, and nothing downloaded until the visitor
 * presses play (`preload="none"`), so the video costs a visitor who never plays it nothing.
 *
 * The controls are our own, in the page's colours, instead of the browser's grey bar: play and
 * pause, the time, a seek bar (a real range input, so the keyboard and screen readers work it),
 * mute and full screen. They show while paused and on hover or keyboard focus, and fade while it
 * plays. Clicking the picture plays or pauses it; at the end, Watch again restarts it.
 */
export function DemoVideo({
  sources,
  poster,
  label,
}: {
  sources: ReadonlyArray<{ src: string; type: string }>;
  poster: string;
  label: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  function play() {
    const video = videoRef.current;
    if (!video) return;
    if (video.ended) video.currentTime = 0;
    setStarted(true);
    setEnded(false);
    // Pressing a button is the user gesture that lets it play with sound; a refusal leaves the
    // play button showing, so there is still something to press.
    video.play().catch(() => setPlaying(false));
  }

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) play();
    else video.pause();
  }

  function seek(to: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = to;
    setTime(to);
    setEnded(false);
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  function fullScreen() {
    const frame = frameRef.current;
    if (!frame) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else frame.requestFullscreen?.().catch(() => {});
  }

  const progress = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <div ref={frameRef} className="group/player relative aspect-video overflow-hidden rounded-2xl bg-[#1a120d]">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-contain cursor-pointer"
        poster={poster}
        preload="none"
        playsInline
        aria-label={label}
        onClick={toggle}
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
        }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
      >
        {sources.map((source) => (
          <source key={source.src} src={source.src} type={source.type} />
        ))}
      </video>

      {/* Before the first play, and after the end: the one big button, over a soft wash so it
          reads against a busy screenshot. Flex centres the circle in the frame; its label hangs
          below the circle (out of flow) rather than pushing it up. */}
      {(!started || ended) && (
        <button
          type="button"
          onClick={play}
          aria-label={ended ? "Watch the tour again" : label}
          className="group absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_center,rgba(26,18,13,0.55)_0%,rgba(26,18,13,0.25)_45%,rgba(26,18,13,0.1)_100%)] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-white"
        >
          <span className="relative h-16 w-16 sm:h-20 sm:w-20">
            {/* A soft halo breathing out from the button before the first play: enough to say
                "press me", slow enough not to nag. Off for anyone who asked for less motion. */}
            {!ended && (
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full bg-white/35 motion-safe:animate-[demo-halo_2.8s_cubic-bezier(0.16,1,0.3,1)_infinite]"
              />
            )}
            <span className="relative flex h-full w-full items-center justify-center rounded-full bg-[#3e2719] text-white shadow-2xl shadow-black/40 ring-8 ring-white/25 transition-transform duration-200 group-hover:scale-105">
              {ended ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7 sm:h-8 sm:w-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12a8 8 0 1 0 2.34-5.66M4 4v4.5h4.5" />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7 sm:h-8 sm:w-8" fill="currentColor">
                  <path d={PLAY_PATH} />
                </svg>
              )}
            </span>
            <span className="absolute left-1/2 top-full mt-4 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/90 px-3.5 py-1 text-xs sm:text-sm font-semibold text-[#3e2719] shadow-lg shadow-black/20">
              {ended ? "Watch again" : "Watch the 1-minute tour"}
            </span>
          </span>
        </button>
      )}

      {/* The control bar, once it has started: visible while paused, on hover and on keyboard
          focus; faded out while playing so it never covers the picture for long. */}
      {started && !ended && (
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1a120d]/85 via-[#1a120d]/45 to-transparent px-3 sm:px-4 pt-10 pb-2 sm:pb-3 transition-opacity duration-300 ${
            playing ? "opacity-0 group-hover/player:opacity-100 focus-within:opacity-100" : "opacity-100"
          }`}
        >
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            onChange={(event) => seek(Number(event.currentTarget.value))}
            aria-label="Seek"
            aria-valuetext={`${clock(time)} of ${clock(duration)}`}
            className="block w-full h-1.5 cursor-pointer appearance-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white"
            style={{ background: `linear-gradient(to right, #c98a52 ${progress}%, rgba(255,255,255,0.25) ${progress}%)` }}
          />
          <div className="mt-1.5 flex items-center gap-1 sm:gap-2">
            <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className={CONTROL}>
              {playing ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                  <rect x="6.5" y="5" width="4" height="14" rx="1" />
                  <rect x="13.5" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                  <path d={PLAY_PATH} />
                </svg>
              )}
            </button>
            <span className="text-xs sm:text-sm font-medium tabular-nums text-white/90">
              {clock(time)} / {clock(duration)}
            </span>
            <span className="flex-1" />
            <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} className={CONTROL}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" />
                {muted ? <path d="m16 9 5 6m0-6-5 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
              </svg>
            </button>
            <button type="button" onClick={fullScreen} aria-label="Full screen" className={CONTROL}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
