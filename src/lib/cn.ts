/**
 * Join class names, dropping falsey entries.
 *
 * Deliberately not `tailwind-merge`: the component library composes fixed variant
 * strings rather than overriding utilities, so there is nothing to de-duplicate and
 * no reason to carry the dependency.
 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
