/**
 * Upload a `pg_dump` stream to the documents bucket (D-07).
 *
 * Reads the dump on stdin rather than running `pg_dump` itself, so the dump is produced by
 * the postgres container — whose client always matches its own server — while the upload
 * happens here, where the S3 credentials and driver already live. Neither container needs a
 * package it does not already have:
 *
 *   docker compose exec -T postgres pg_dump -U reconciliation -Fc reconciliation \
 *     | docker compose exec -T app npm run db:backup-upload
 *
 * Retention is not implemented here on purpose. It belongs to the bucket's lifecycle rules
 * (architecture §ops: 30 daily + 12 monthly), so this process only ever writes. A backup job
 * that can delete is a backup job that can delete the wrong thing, usually at 3am and
 * usually unattended.
 */
import { storage } from "@/src/services/storage/driver";

/** The first five bytes of a `pg_dump --format=custom` archive. */
const CUSTOM_FORMAT_MAGIC = "PGDMP";

/**
 * Smaller than any real dump of this schema, which has fourteen tables before a single row.
 * A truncated upload is worse than a failed one: it looks like a backup until the day it is
 * needed.
 */
const MIN_PLAUSIBLE_BYTES = 4096;

function readStdin(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks)));
    process.stdin.on("error", reject);
  });
}

/** `2026-08-20` in UTC — unambiguous, and the same calendar day as a nightly Detroit run. */
function stamp(now: Date): { day: string; month: string; isFirstOfMonth: boolean } {
  const iso = now.toISOString();
  return {
    day: iso.slice(0, 10),
    month: iso.slice(0, 7),
    isFirstOfMonth: now.getUTCDate() === 1,
  };
}

async function main(): Promise<void> {
  const dump = await readStdin();

  // `pg_dump` failing mid-pipe still closes stdin cleanly, so the bytes are checked rather
  // than the exit status of a process this one cannot see.
  if (dump.byteLength === 0) {
    throw new Error("No dump received on stdin — did pg_dump fail? Nothing was uploaded.");
  }
  if (dump.subarray(0, 5).toString("latin1") !== CUSTOM_FORMAT_MAGIC) {
    throw new Error(
      "Input is not a pg_dump custom-format archive (missing PGDMP header). " +
        "Nothing was uploaded — check the pg_dump command uses -Fc.",
    );
  }
  if (dump.byteLength < MIN_PLAUSIBLE_BYTES) {
    throw new Error(
      `Dump is only ${dump.byteLength} bytes, which is too small to be this database. ` +
        "Nothing was uploaded.",
    );
  }

  const { day, month, isFirstOfMonth } = stamp(new Date());
  const store = storage();

  const keys = [`backups/daily/${day}.dump`];
  // The monthly copy is a separate object, not a tag: daily and monthly expire on different
  // lifecycle rules, and one object cannot be on two schedules.
  if (isFirstOfMonth) keys.push(`backups/monthly/${month}.dump`);

  for (const key of keys) {
    await store.put({ key, body: dump, contentType: "application/octet-stream" });

    // Read it back. An upload that reports success but stored nothing readable is exactly
    // the failure a backup regime exists to prevent, and it is cheap to rule out.
    const readBack = await store.get(key);
    if (readBack.byteLength !== dump.byteLength) {
      throw new Error(
        `Verification failed for ${key}: wrote ${dump.byteLength} bytes, read back ${readBack.byteLength}.`,
      );
    }
    console.log(`Uploaded and verified ${key} (${(dump.byteLength / 1_048_576).toFixed(2)} MB)`);
  }
}

main().catch((error: unknown) => {
  console.error("Backup failed:", error instanceof Error ? error.message : error);
  // Non-zero so cron reports it. A silent nightly failure is the usual way backups are
  // discovered to have been broken for months.
  process.exit(1);
});
