import { UI } from "@/src/domain/strings";

/**
 * The messages a shared link's page can be sent back to show, by the `?e=` its routes redirect
 * with — the form fallback of the unlock route (no JavaScript yet) and the file route's refusals.
 * Only these keys are read; anything else in the query is ignored.
 */
const NOTICES = {
  wrong: { message: UI.sharePasswordWrong, blocksFile: false },
  wait: { message: UI.shareTooManyTries, blocksFile: false },
  refused: { message: UI.requestRefused, blocksFile: false },
  busy: { message: UI.shareTooManyOpens, blocksFile: true },
  unreadable: { message: UI.shareOpenFailed, blocksFile: true },
} as const;

export type ShareNoticeKey = keyof typeof NOTICES;

/**
 * The notice for a query value. `blocksFile` notices come from the file route itself, so the
 * page shows them instead of redirecting straight back to the file and looping.
 */
export function shareNotice(value: unknown): { message: string; blocksFile: boolean } | null {
  if (typeof value !== "string" || !Object.hasOwn(NOTICES, value)) return null;
  return NOTICES[value as ShareNoticeKey];
}

/** The link's page with a notice, relative like every redirect on this surface. */
export function sharePageWithNotice(token: string, key: ShareNoticeKey): string {
  return `/s/${encodeURIComponent(token)}?e=${key}`;
}
