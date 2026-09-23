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
 * "Welcome back, tech@teampursuit.org!". With no name on file this takes the local part and
 * leaves it as typed rather than guessing at capitalisation, and an address with no local
 * part at all falls back to a greeting with no name in it (handled by the caller).
 */
export function greetingName(name: string | null | undefined, email: string): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed.split(/\s+/)[0];
  return email.split("@")[0]?.trim() ?? "";
}
