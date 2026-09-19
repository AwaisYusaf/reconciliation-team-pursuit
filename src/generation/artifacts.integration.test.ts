/**
 * The artifact cache's id and no-body paths (PHASE-12 §4, U-7, U-8): sharing a file needs the
 * pinned row, never its bytes, and serving one streams it.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("artifact cache ids, ensureArtifact and storage streams (integration)", async () => {
  const { db } = await import("@/src/db");
  const { generatedArtifacts, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { ensureArtifact, resolveArtifact } = await import("./artifacts");
  const { storage } = await import("@/src/services/storage/driver");
  const { generatedArtifactKey } = await import("@/src/services/storage/keys");

  let orgId: string;
  let sourceId: string;
  let monthCounter = 0;
  function freshMonth(): string {
    monthCounter += 1;
    return `2086-${String(monthCounter).padStart(2, "0")}`;
  }

  function input(month: string, hash: string, build: () => Promise<Buffer>) {
    return {
      orgId,
      fundingSourceId: sourceId,
      month: month as `${number}-${number}`,
      type: "summary_xlsx" as const,
      extension: "xlsx" as const,
      hash,
      build,
    };
  }

  async function rowsFor(month: string) {
    return db
      .select({ id: generatedArtifacts.id, downloadedAt: generatedArtifacts.downloadedAt })
      .from(generatedArtifacts)
      .where(and(eq(generatedArtifacts.orgId, orgId), eq(generatedArtifacts.month, month)));
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: `Artifact Org ${Date.now()}` });
    orgId = org.orgId;
    sourceId = org.fundingSourceId;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await rm(path.join(process.cwd(), ".storage", "org", orgId), { recursive: true, force: true });
  });

  it("ensureArtifact builds on a miss, pins the row and returns its id", async () => {
    const month = freshMonth();
    const build = vi.fn(async () => Buffer.from("first bytes"));

    const result = await ensureArtifact(input(month, "a".repeat(32), build));

    expect(build).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(false);
    const rows = await rowsFor(month);
    expect(rows).toEqual([{ id: result.artifactId, downloadedAt: expect.any(Date) }]);
  });

  it("ensureArtifact on a hit checks the object exists and never reads it", async () => {
    const month = freshMonth();
    const first = await resolveArtifact(input(month, "b".repeat(32), async () => Buffer.from("saved")));

    const get = vi.spyOn(storage(), "get");
    const build = vi.fn(async () => Buffer.from("never"));
    const again = await ensureArtifact(input(month, "b".repeat(32), build));
    // Read before restoring: `mockRestore` also clears the call history, which made this
    // assertion unable to fail (found by mutating `exists` into `get`).
    const reads = get.mock.calls.length;
    get.mockRestore();

    expect(again).toEqual({ artifactId: first.artifactId, cached: true });
    expect(reads).toBe(0);
    expect(build).not.toHaveBeenCalled();
  });

  it("resolveArtifact returns the same id on a hit, with the bytes", async () => {
    const month = freshMonth();
    const first = await resolveArtifact(input(month, "c".repeat(32), async () => Buffer.from("bytes")));
    const second = await resolveArtifact(input(month, "c".repeat(32), async () => Buffer.from("never")));
    expect(second.artifactId).toBe(first.artifactId);
    expect(second.cached).toBe(true);
    expect(second.body.toString()).toBe("bytes");
  });

  it("ensureArtifact rebuilds a missing object behind the same row", async () => {
    const month = freshMonth();
    const hash = "d".repeat(32);
    const first = await ensureArtifact(input(month, hash, async () => Buffer.from("original")));
    const key = generatedArtifactKey({
      orgId,
      fundingSourceId: sourceId,
      month: month as `${number}-${number}`,
      type: "summary_xlsx",
      inputsHash: hash,
      extension: "xlsx",
    });
    await storage().delete(key);

    const build = vi.fn(async () => Buffer.from("original"));
    const again = await ensureArtifact(input(month, hash, build));

    expect(build).toHaveBeenCalledTimes(1);
    expect(again.artifactId).toBe(first.artifactId);
    expect((await storage().get(key)).toString()).toBe("original");
  });

  it("a concurrent insert of the same bytes wins, and its row is the one returned", async () => {
    const month = freshMonth();
    const hash = "e".repeat(32);
    let concurrentId = "";

    const result = await ensureArtifact(
      input(month, hash, async () => {
        // Another request finishes the same build while this one is still building.
        const [row] = await db
          .insert(generatedArtifacts)
          .values({
            orgId,
            fundingSourceId: sourceId,
            month,
            type: "summary_xlsx",
            inputsHash: hash,
            s3Key: `org/${orgId}/months/${month}/generated/${sourceId}/summary_xlsx-${hash}.xlsx`,
            sizeBytes: 5,
            downloadedAt: null,
          })
          .returning({ id: generatedArtifacts.id });
        concurrentId = row.id;
        return Buffer.from("same!");
      }),
    );

    expect(result.artifactId).toBe(concurrentId);
    const rows = await rowsFor(month);
    expect(rows).toHaveLength(1);
    // Pinned even though the winning insert wasn't.
    expect(rows[0].downloadedAt).not.toBeNull();
  });

  describe("storage stream and stat (local driver)", () => {
    it("streams exactly the stored bytes and reports their size", async () => {
      const key = `org/${orgId}/stream-test/file.bin`;
      const bytes = Buffer.from(Array.from({ length: 70_000 }, (_, i) => i % 251));
      await storage().put({ key, body: bytes, contentType: "application/octet-stream" });

      const { body, size } = await storage().stream(key);
      const streamed = Buffer.from(await new Response(body).arrayBuffer());

      expect(size).toBe(bytes.byteLength);
      expect(streamed.equals(bytes)).toBe(true);
      expect(await storage().stat(key)).toEqual({ size: bytes.byteLength });
    });

    it("stat is null for a missing object", async () => {
      expect(await storage().stat(`org/${orgId}/stream-test/missing.bin`)).toBeNull();
    });

    it("refuses to stream outside the storage root", async () => {
      await expect(storage().stream("../package.json")).rejects.toThrow(/storage root/);
    });
  });
});
