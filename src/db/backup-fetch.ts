/**
 * Write a stored backup to stdout, so it can be piped straight into `pg_restore` (D-07).
 *
 * The mirror of `backup-upload`, and deliberately the same shape: this container has the S3
 * credentials, the postgres container has the matching `pg_restore`, and the dump travels
 * between them through a pipe rather than a file on the host.
 *
 *   docker compose exec -T app npm run --silent db:backup-fetch -- backups/daily/2026-08-20.dump \
 *     | docker compose exec -T postgres pg_restore --no-owner --no-privileges \
 *         -U reconciliation -d reconciliation --clean --if-exists
 *
 * Progress goes to stderr, never stdout — anything written to stdout is part of the archive.
 */
import { storage } from "@/src/services/storage/driver";

const CUSTOM_FORMAT_MAGIC = "PGDMP";

async function main(): Promise<void> {
  const key = process.argv[2];
  if (!key) {
    throw new Error(
      "Usage: npm run db:backup-fetch -- backups/daily/YYYY-MM-DD.dump\n" +
        "List what exists in the S3 console under the backups/ prefix.",
    );
  }
  // Only ever reads backups. A typo here should not be able to stream a client document.
  if (!key.startsWith("backups/")) {
    throw new Error(`Refusing to fetch "${key}": only keys under backups/ may be read this way.`);
  }

  const dump = await storage().get(key);

  if (dump.subarray(0, 5).toString("latin1") !== CUSTOM_FORMAT_MAGIC) {
    throw new Error(`${key} is not a pg_dump custom-format archive. Refusing to pipe it.`);
  }

  console.error(`Fetched ${key} (${(dump.byteLength / 1_048_576).toFixed(2)} MB)`);
  process.stdout.write(dump);
}

main().catch((error: unknown) => {
  console.error("Fetch failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
