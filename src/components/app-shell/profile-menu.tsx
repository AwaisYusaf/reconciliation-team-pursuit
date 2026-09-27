"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { UI } from "@/src/domain/strings";
import { initialsFor } from "@/src/domain/user-display";
import { cn } from "@/src/lib/cn";

/**
 * The header's profile control: an avatar that opens the account menu.
 *
 * Replaces the standalone Sign out button. Sign out is the only destructive thing in the
 * header and it sat permanently next to the tabs; behind a menu it is one deliberate step
 * away instead of one stray click.
 *
 * Not built on `ui/menu.tsx`: that menu portals to `document.body` to escape a scrolling
 * table, and its trigger is a fixed glyph button. This one is anchored in a header that
 * nothing clips, and its trigger is an avatar, so a local panel is both simpler and keeps the
 * sign-out `<form>` inside the menu rather than stranded across a portal boundary.
 */

export function ProfileMenu({
  name,
  email,
  photoUrl,
  signOut,
  profileHref = "/r/settings?section=account",
  featureRequestsHref = null,
}: {
  name: string | null;
  email: string;
  /** Set once a profile photo exists; until then the avatar is initials. */
  photoUrl?: string | null;
  /** Where "Your profile" goes, or `null` to leave the item out — see below. */
  profileHref?: string | null;
  /**
   * Where "Feature requests" goes (PHASE-17, ticket §1), or `null`, the default, to leave it out.
   * Opt-in rather than opt-out: only the paid `/r` shell passes it, so an organization without a
   * paid plan, which can reach nothing but the plan chooser, and staff in `/a` never see it.
   */
  featureRequestsHref?: string | null;
  /** The sign-out server action, passed down so this stays a presentational client component. */
  signOut: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const displayName = name?.trim() || email;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Your account"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "w-9 h-9 rounded-full overflow-hidden border border-line bg-section",
          "flex items-center justify-center text-[13px] font-bold text-ink",
          "hover:border-accent transition-colors",
        )}
      >
        {photoUrl ? (
          /* A plain `img`, not `next/image`: the source is a runtime storage route behind the
             session, so there is nothing for the build-time optimiser to fetch, and the avatar
             renders at a fixed 36px where the loader would save nothing. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span aria-hidden="true">{initialsFor(name, email)}</span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Your account"
          className="absolute right-0 top-full mt-2 z-40 w-[232px] bg-surface border border-line rounded-[10px] shadow-lg overflow-hidden pop-in"
        >
          <div className="px-3.5 py-3 border-b border-line">
            <div className="text-[15px] font-bold text-ink truncate">{displayName}</div>
            {/* Only when the name is what is shown above, or this repeats the same string. */}
            {name?.trim() && <div className="text-[13px] text-sub truncate">{email}</div>}
          </div>

          {/*
            Omitted for staff. `/r/settings` is a customer route, and a staff session is not a
            customer session, so following it would land an AB Solutions user on the sign-in
            page — a menu item that signs you out by accident is worse than no menu item.
          */}
          {profileHref && (
            <Link
              href={profileHref}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block w-full min-h-11 flex items-center px-3.5 text-[15px] text-ink hover:bg-section"
            >
              Your profile
            </Link>
          )}

          {featureRequestsHref && (
            <Link
              href={featureRequestsHref}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                "block w-full min-h-11 flex items-center px-3.5 text-[15px] text-ink hover:bg-section",
                profileHref && "border-t border-line",
              )}
            >
              {UI.featureRequestsTitle}
            </Link>
          )}

          <form
            action={signOut}
            className={profileHref || featureRequestsHref ? "border-t border-line" : undefined}
          >
            <button
              type="submit"
              role="menuitem"
              className="block w-full min-h-11 flex items-center px-3.5 text-[15px] text-ink text-left hover:bg-section"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
