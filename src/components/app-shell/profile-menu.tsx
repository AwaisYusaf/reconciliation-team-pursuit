"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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

/**
 * Up to two initials from a display name, falling back to the email.
 *
 * Splits on whitespace and takes the first and last part, so "Mary-Anne Carter" reads MC and
 * a single name reads one letter rather than a doubled one. The email fallback takes the
 * local part only, because the domain is the same for everyone in an organisation and
 * initials drawn from it would make every avatar identical.
 */
export function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0]?.trim() || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (first + last).toUpperCase();
}

export function ProfileMenu({
  name,
  email,
  photoUrl,
  signOut,
}: {
  name: string | null;
  email: string;
  /** Set once a profile photo exists; until then the avatar is initials. */
  photoUrl?: string | null;
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

          <Link
            href="/r/settings?section=account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block w-full min-h-11 flex items-center px-3.5 text-[15px] text-ink hover:bg-section"
          >
            Your profile
          </Link>

          <form action={signOut} className="border-t border-line">
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
