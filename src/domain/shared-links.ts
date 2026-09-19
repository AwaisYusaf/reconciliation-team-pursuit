/**
 * Facts about shared links that the server, the packet tab and the public pages must agree on
 * (PHASE-12). Pure and client-safe, so the browser checks the same rules the server enforces.
 */
import type { ArtifactType } from "@/src/db/schema";

/** A shared link's password: 6–128 characters, not trimmed, no composition rules (P5). */
export const SHARE_PASSWORD_MIN = 6;
export const SHARE_PASSWORD_MAX = 128;

/** The two month files that can be shared, as the screen names them. */
export type SharedFileKind = "packet" | "summary";

/** The same two, as `generated_artifacts.type` and `shared_links.artifact_type` store them. */
export type SharedArtifactType = Extract<ArtifactType, "packet_pdf" | "summary_xlsx">;

const TYPE_OF: Record<SharedFileKind, SharedArtifactType> = {
  packet: "packet_pdf",
  summary: "summary_xlsx",
};

export function artifactTypeOf(kind: SharedFileKind): SharedArtifactType {
  return TYPE_OF[kind];
}

/**
 * The kind for a stored type, or null for any type that cannot be shared — so a new artifact
 * type is refused rather than silently read as a summary.
 */
export function sharedFileKindOf(type: string): SharedFileKind | null {
  if (type === "packet_pdf") return "packet";
  if (type === "summary_xlsx") return "summary";
  return null;
}
