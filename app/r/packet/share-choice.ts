import type { SharedFileKind } from "@/src/domain/shared-links";

/**
 * The share dialog's two decisions, kept pure so they are tested directly (PHASE-12 review): which
 * file it opens on, and whether a picked file shows its existing row instead of the form.
 */

/** Opens on the first file not yet shared — the packet, unless only the packet already is. */
export function initialShareKind(links: ReadonlyArray<{ kind: SharedFileKind }>): SharedFileKind {
  const shared = new Set(links.map((link) => link.kind));
  return shared.has("packet") && !shared.has("summary") ? "summary" : "packet";
}

/** Appendix A §2: an already-shared file shows its link row instead of the form. */
export function sharedLinkFor<T extends { kind: SharedFileKind }>(
  kind: SharedFileKind,
  links: ReadonlyArray<T>,
): T | null {
  return links.find((link) => link.kind === kind) ?? null;
}
