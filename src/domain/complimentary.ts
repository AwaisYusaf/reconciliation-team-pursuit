/**
 * Whether an organisation's complimentary access is off, active or ended (Phase 9 §7 Q6).
 * Moved here from `src/modules/admin/directory.ts` (Phase 15, P10) so `orgEntitlement`
 * (`src/modules/billing/entitlement.ts`) can share it without importing the admin module.
 */
import type { IsoDate } from "@/src/domain/dates";

export type ComplimentaryState = "none" | "active" | "ended";

/**
 * An end date of today is still active — it ends *after* that day, so only a strictly earlier
 * date counts as ended.
 */
export function complimentaryState(
  org: { complimentary: boolean; complimentaryUntil: IsoDate | null },
  today: IsoDate,
): ComplimentaryState {
  if (!org.complimentary) return "none";
  if (org.complimentaryUntil === null) return "active";
  return org.complimentaryUntil < today ? "ended" : "active";
}

/** `orgEntitlement`'s and the Checkout refusal's shared check (P10): true only while active. */
export function isComplimentaryNow(
  org: { complimentary: boolean; complimentaryUntil: IsoDate | null },
  today: IsoDate,
): boolean {
  return complimentaryState(org, today) === "active";
}
