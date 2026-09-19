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
export const PACKET_GENERATOR_VERSION = "packet-12";

// Bumped "summary-3": the detail sheet gained a Receipt Total column (R1.3a). Without this, pinned and cached
// artifacts would keep serving output built before the change.
export const SUMMARY_GENERATOR_VERSION = "summary-3";

// Bumped "cover-7": the converter now resolves Aptos to Carlito instead of falling back to
// DejaVu Sans (D-78), so every rendered sheet changes metrics. The font lives in the image, not
// in the snapshot, so without this bump pinned and cached artifacts keep serving the wide render.
// Bumped "cover-8": the heading now carries the expense reference (D-83). Without this, pinned and
// cached sheets keep printing headings the packet's links cannot anchor on.
export const COVER_SHEET_GENERATOR_VERSION = "cover-8";
