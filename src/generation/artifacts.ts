import "server-only";

/**
 * Output cache and pinning (R10.4, R10.6), shared by all three generators.
 *
 * Every output is a pure function of the month snapshot, so the snapshot's canonical hash
 * identifies the bytes. A download looks for an artifact carrying that hash and reuses it;
 * anything else regenerates. Whatever is actually served is then pinned — `downloaded_at`
 * set — so the organisation can always reproduce exactly what the City received, even
 * after the underlying records change.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/src/db";
import { generatedArtifacts } from "@/src/db/schema";
import type { ArtifactType } from "@/src/db/schema";
import type { MonthKey } from "@/src/domain/dates";
import { storage } from "@/src/services/storage/driver";
import { generatedArtifactKey } from "@/src/services/storage/keys";

import { CONTENT_TYPES } from "./content-types";

export { canonicalJson, inputsHash } from "./cache-key";

/**
 * Builds running now, by exact output (scope + hash). A second request for the same bytes waits
 * for the first build instead of starting its own: downloading the packet and sharing it at the
 * same moment would otherwise assemble a 70 MB packet twice, at about three times its size in
 * memory each, on a 3.7 GB box shared with Postgres (PHASE-12 review). Both callers then store
 * and record the same deterministic bytes, which `generated_artifacts_content_uq` already makes
 * idempotent.
 *
 * ponytail: in-process, single container — the same ceiling as `rate-limit.ts`.
 */
const buildsInFlight = new Map<string, Promise<Buffer>>();

function buildOnce(key: string, build: () => Promise<Buffer>): Promise<Buffer> {
  const running = buildsInFlight.get(key);
  if (running) return running;
  const started = build().finally(() => buildsInFlight.delete(key));
  buildsInFlight.set(key, started);
  return started;
}

export type ResolveArtifactInput = {
  orgId: string;
  fundingSourceId: string;
  month: MonthKey;
  type: ArtifactType;
  /** Set for cover sheets; null for the packet and the workbook. */
  lineItemId?: string | null;
  /** Only used to make the object key readable. */
  lineItemName?: string | null;
  extension: "xlsx" | "docx" | "pdf";
  hash: string;
  /** Called only on a cache miss. */
  build: () => Promise<Buffer>;
};

export type ResolvedArtifact = {
  /** The `generated_artifacts` row that was served (and is now pinned). */
  artifactId: string;
  body: Buffer;
  contentType: string;
  /** True when the bytes came from storage rather than being rebuilt. */
  cached: boolean;
};

/**
 * Return the bytes for one output, generating them if no artifact matches the hash, and
 * pin whatever is served.
 */
export async function resolveArtifact(input: ResolveArtifactInput): Promise<ResolvedArtifact> {
  const resolved = await resolve(input, true);
  return { ...resolved, body: resolved.body! };
}

/**
 * Make sure a pinned artifact exists for this output, without reading it back.
 *
 * Sharing a file by link (PHASE-12) needs the artifact's row, not its bytes: a cache hit on a
 * 73 MB packet would otherwise be read into memory only to be thrown away. A hit is checked for
 * existence instead; a missing object is rebuilt and written back exactly as `resolveArtifact`
 * does after a failed read.
 */
export async function ensureArtifact(
  input: ResolveArtifactInput,
): Promise<{ artifactId: string; cached: boolean }> {
  const { artifactId, cached } = await resolve(input, false);
  return { artifactId, cached };
}

async function resolve(
  input: ResolveArtifactInput,
  withBody: boolean,
): Promise<{ artifactId: string; body: Buffer | null; contentType: string; cached: boolean }> {
  const lineItemId = input.lineItemId ?? null;
  const contentType = CONTENT_TYPES[input.extension];
  const store = storage();
  const buildKey = [input.orgId, input.fundingSourceId, input.month, input.type, lineItemId, input.hash].join(":");
  const build = () => buildOnce(buildKey, input.build);

  const scope = and(
    eq(generatedArtifacts.orgId, input.orgId),
    eq(generatedArtifacts.fundingSourceId, input.fundingSourceId),
    eq(generatedArtifacts.month, input.month),
    eq(generatedArtifacts.type, input.type),
    lineItemId
      ? eq(generatedArtifacts.lineItemId, lineItemId)
      : isNull(generatedArtifacts.lineItemId),
  );

  const [hit] = await db
    .select({ id: generatedArtifacts.id, s3Key: generatedArtifacts.s3Key })
    .from(generatedArtifacts)
    .where(and(scope, eq(generatedArtifacts.inputsHash, input.hash)))
    // Prefer an already-pinned row: it is the one that will still be here next month.
    // Postgres sorts DESC as NULLS FIRST, which would pick the unpinned row instead.
    .orderBy(sql`${generatedArtifacts.downloadedAt} desc nulls last`)
    .limit(1);

  if (hit) {
    try {
      if (withBody) {
        const body = await store.get(hit.s3Key);
        await pin(hit.id);
        return { artifactId: hit.id, body, contentType, cached: true };
      }
      if (await store.exists(hit.s3Key)) {
        await pin(hit.id);
        return { artifactId: hit.id, body: null, contentType, cached: true };
      }
    } catch {
      // Falls through to the rebuild below.
    }
    // The object could not be read. The row is never deleted here: it may be a pinned
    // record of what the City received, and the read may have failed for a reason that
    // says nothing about the object — a throttle, a timeout, an expired credential. The
    // bytes are deterministic (R10.1), so rebuilding and writing back to the same key
    // restores the artifact without losing the record that it was downloaded.
    const body = await build();
    await store.put({ key: hit.s3Key, body, contentType });
    await pin(hit.id);
    return { artifactId: hit.id, body, contentType, cached: false };
  }

  const body = await build();
  const key = generatedArtifactKey({
    orgId: input.orgId,
    fundingSourceId: input.fundingSourceId,
    month: input.month,
    type: input.type,
    lineItemName: input.lineItemName ?? null,
    inputsHash: input.hash,
    extension: input.extension,
  });

  await store.put({ key, body, contentType });

  // Written pre-pinned: it is being served right now, which is what pinning records.
  // `generated_artifacts_content_uq` makes this idempotent, so two concurrent downloads of
  // the same month converge on one row rather than each inserting their own.
  const [inserted] = await db
    .insert(generatedArtifacts)
    .values({
      orgId: input.orgId,
      fundingSourceId: input.fundingSourceId,
      month: input.month,
      type: input.type,
      lineItemId,
      inputsHash: input.hash,
      s3Key: key,
      sizeBytes: body.byteLength,
      downloadedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: generatedArtifacts.id });

  // A concurrent request inserted the same bytes first: its row is this artifact. Pinned in
  // case it was written by a path that doesn't pin.
  let artifactId = inserted?.id;
  if (!artifactId) {
    const [existing] = await db
      .select({ id: generatedArtifacts.id })
      .from(generatedArtifacts)
      .where(and(scope, eq(generatedArtifacts.inputsHash, input.hash)))
      .limit(1);
    if (!existing) throw new Error("Artifact insert conflicted but no matching row was found");
    artifactId = existing.id;
    await pin(artifactId);
  }

  // Drop the superseded *unpinned* cache entry, if a preview path left one. Pinned rows are
  // history and are never collected here — R10.6 makes them permanent, and the nightly
  // sweep only ever considers unpinned objects.
  const stale = await db
    .select({ id: generatedArtifacts.id, s3Key: generatedArtifacts.s3Key })
    .from(generatedArtifacts)
    .where(
      and(
        scope,
        isNull(generatedArtifacts.downloadedAt),
        sql`${generatedArtifacts.inputsHash} <> ${input.hash}`,
      ),
    );
  for (const row of stale) {
    // Re-checked in the delete itself: a share or download may have pinned this row since the
    // select, and a pinned row is permanent (R10.6) — possibly the file behind a shared link.
    const [deleted] = await db
      .delete(generatedArtifacts)
      .where(and(eq(generatedArtifacts.id, row.id), isNull(generatedArtifacts.downloadedAt)))
      .returning({ id: generatedArtifacts.id });
    if (deleted) await store.delete(row.s3Key).catch(() => {});
  }

  return { artifactId, body, contentType, cached: false };
}

async function pin(id: string): Promise<void> {
  await db
    .update(generatedArtifacts)
    .set({ downloadedAt: new Date() })
    .where(and(eq(generatedArtifacts.id, id), isNull(generatedArtifacts.downloadedAt)));
}
