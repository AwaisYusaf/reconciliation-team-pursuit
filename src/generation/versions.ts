/**
 * Generator versions — one per output, part of every artifact's cache key (R10.4).
 *
 * Bump a version when that output's bytes change for a reason the snapshot doesn't carry
 * (layout, ordering, fonts, links). Without a bump the cache key is byte-identical, so every
 * existing month keeps serving the old file.
 *
 * A bump never touches a file already shared by link, and does not flag its row "records
 * changed" (PHASE-12 P14, §8): the link keeps serving its pinned file in the older format until
 * the next Update, which is only offered once records change. After a correctness fix, tell the
 * client to stop and re-share any link that must carry it.
 *
 * Kept here rather than in the route files because the download routes and sharing
 * (`src/modules/packet/month-output.ts`) must hash with the same value, and a route file
 * cannot export arbitrary constants.
 */

// Bumped "packet-10": the packet embeds the cover sheet, whose font resolution changed (D-78).
// Neither that nor D-77's reordering touches a snapshot field, so without a bump the cache key is
// byte-identical and every existing month keeps serving the old packet.
// Bumped "packet-11": the packet embeds the cover sheet, whose heading now carries the
// reference (D-83). Without this, pinned and cached packets keep serving the old sheets.
// Bumped "packet-12": the packet now carries internal links and an outline (D-83). Links are
// code, not snapshot data; without this every cached packet stays unlinked.
// Bumped "packet-13": no dashes in anything the packet prints (D-113). The footer separates its
// parts with bars, the summary and index titles read as phrases, the embedded cover sheet heading
// is `{Name} ({reference}):`, and the outline reads `{reference} | {Name}`. The copy review
// (PHASE-13 §9) also reworded the index's subtitle and its no-receipt heading, and the summary
// page's contract line now separates its parts with bars too.
// Bumped "packet-14": the contract summary and the expense index are hidden for now, so the
// packet starts at the first cover sheet (D-114). Bump again when they are uncommented.
// Bumped "packet-15": the packet is drawn in the app's colours (D-137): the embedded cover sheets,
// the footer, and the hidden summary and index sections.
export const PACKET_GENERATOR_VERSION = "packet-15";

// Bumped "summary-3": the detail sheet gained a Receipt Total column (R1.3a). Without this, pinned and cached
// artifacts would keep serving output built before the change.
export const SUMMARY_GENERATOR_VERSION = "summary-3";

// Bumped "cover-7": the converter now resolves Aptos to Carlito instead of falling back to
// DejaVu Sans (D-78), so every rendered sheet changes metrics. The font lives in the image, not
// in the snapshot, so without this bump pinned and cached artifacts keep serving the wide render.
// Bumped "cover-8": the heading now carries the expense reference (D-83). Without this, pinned and
// cached sheets keep printing headings the packet's links cannot anchor on.
// Bumped "cover-9": the heading is `{Name} ({reference}):` and the no-receipt note reads
// "(Note: No receipt available. Reason: …)" (D-113), neither of which the snapshot carries.
// Bumped "cover-10": the sheet is drawn in the app's colours (D-137), not the old yellow.
export const COVER_SHEET_GENERATOR_VERSION = "cover-10";
