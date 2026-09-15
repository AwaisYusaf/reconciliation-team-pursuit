"use client";

/**
 * Keeps a running walkthrough moving past a screen that cannot show its own tour right now
 * (Phase 7, D-95 follow-up).
 *
 * Cover Sheets, Packet and Contract Summary each render a "choose a funding source first"
 * panel instead of their real content while the header is on "All funding sources" — so their
 * tours have nothing to point at and are never mounted there. The walkthrough stopped dead at
 * the first of them: it waits to be carried on by a tour finishing, and no tour ever started.
 * For an organisation with more than one funding source that meant Cover Sheets onward — five
 * of the nine tabs — were never reached at all.
 *
 * Rendering this on that branch hands the walkthrough on to the next tab instead. It
 * deliberately does *not* mark the skipped tour seen: nothing was shown, so it still owes the
 * user its run, and it plays normally the next time they open that tab with a source chosen.
 *
 * Outside a running walkthrough this renders nothing and navigates nowhere — an ordinary visit
 * to Packet with "All" selected behaves exactly as before.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import type { TourKey } from "@/src/db/schema";
import { continueTourSequence } from "@/src/modules/tours/sequence";

export function TourSequenceSkip({ tour }: { tour: TourKey }) {
  const router = useRouter();
  // Once per mount. React Strict Mode runs effects twice in development, and the second run
  // would see the walkthrough already moved on to the next tab — read that as a stale flag —
  // and end the walkthrough it had just handed on. Refs survive that replay.
  const handedOn = useRef(false);

  useEffect(() => {
    if (handedOn.current) return;
    handedOn.current = true;
    continueTourSequence(tour, router);
  }, [tour, router]);

  return null;
}
