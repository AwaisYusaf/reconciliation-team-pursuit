/** "Who did this" display text: the user's name when set, else their email (D-89). */
export function userDisplay(name: string | null | undefined, email: string): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : email;
}
