/** "Who did this" display text: the user's name when set, else their email (D-89). */
export function userDisplay(name: string | null | undefined, email: string): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : email;
}

/**
 * What to call someone when greeting them: their first name.
 *
 * Deliberately not `userDisplay`. That falls back to the whole email address, which is right
 * for an audit line naming who did something and wrong in a greeting, where it would read
 * "Welcome back, tech@authenticbusiness.io!". With no name on file this takes the local part and
 * leaves it as typed rather than guessing at capitalisation, and an address with no local
 * part at all falls back to a greeting with no name in it (handled by the caller).
 */
export function greetingName(name: string | null | undefined, email: string): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed.split(/\s+/)[0];
  return email.split("@")[0]?.trim() ?? "";
}

/**
 * Up to two initials from a display name, falling back to the email.
 *
 * Splits on whitespace and takes the first and last part, so "Mary-Anne Carter" reads MC and
 * a single name reads one letter rather than a doubled one. The email fallback takes the
 * local part only, because the domain is the same for everyone in an organisation and
 * initials drawn from it would make every avatar identical.
 *
 * Here rather than beside the avatar that draws it: this is a pure string function, like the
 * two above, and it had been living in `profile-menu.tsx` — a `"use client"` module — which
 * meant a server component wanting initials had to pull a client component's module in to get
 * them.
 */
export function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0]?.trim() || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (first + last).toUpperCase();
}
