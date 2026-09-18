import { formatMoney } from "@/src/domain/format";

/** Micro-USD (a thousandth of a cent) as money. A single amount read costs about $0.0001, so a
 *  new organization would otherwise show $0.00 for real spending; under a cent shows the cents
 *  to four places, and anything larger rounds to the usual two. */
export function aiCost(microUsd: number): string {
  if (microUsd === 0) return formatMoney(0);
  // Under a cent, four places — a single receipt read costs about $0.0001, so an organisation
  // that has only read a few would otherwise read "$0.00". At a cent or more, the app's own
  // money format, so thousands separators and rounding match every other figure on the page.
  if (microUsd < 10_000) return `$${(microUsd / 1_000_000).toFixed(4)}`;
  return formatMoney(Math.round(microUsd / 10_000));
}
