import "server-only";

/**
 * Storage driver abstraction (decision D-29).
 *
 * Production uses S3 exactly as the architecture specifies. Development uses a
 * filesystem driver so the app is fully workable without AWS credentials — uploads,
 * previews, packet assembly and the February test all behave identically, and the only
 * difference is where bytes land. The driver is chosen by configuration, never by code
 * path, so there is one implementation of every caller.
 *
 * There is deliberately no signed-URL method. D-30 replaced presigned access with
 * server-proxied downloads: bytes are served by `/api/files/[id]`, which authenticates the
 * session and scopes the lookup to the organisation. That is strictly stronger than a
 * bearer URL, and it means there is one download path rather than two.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type PutOptions = {
  key: string;
  body: Buffer;
  contentType: string;
};

export interface StorageDriver {
  readonly name: "s3" | "local";
  put(options: PutOptions): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/* ------------------------------------------------------------------ local */

const LOCAL_ROOT = path.join(process.cwd(), ".storage");

/**
 * Filesystem driver for development.
 *
 * Behaves identically to S3 from every caller's point of view; the only difference is where
 * the bytes land.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = "local" as const;

  private absolute(key: string): string {
    const resolved = path.resolve(LOCAL_ROOT, key);
    // Defence in depth: the key builders already forbid traversal. The separator matters —
    // a bare startsWith would also accept a sibling directory whose name merely begins with
    // the root's, e.g. ".storage-public".
    if (resolved !== LOCAL_ROOT && !resolved.startsWith(LOCAL_ROOT + path.sep)) {
      throw new Error("Refusing to escape the storage root");
    }
    return resolved;
  }

  async put({ key, body }: PutOptions): Promise<void> {
    const target = this.absolute(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.absolute(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.absolute(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.absolute(key), { force: true });
  }

}


/* --------------------------------------------------------------------- s3 */

export class S3StorageDriver implements StorageDriver {
  readonly name = "s3" as const;

  constructor(
    private readonly bucket: string,
    private readonly region: string,
  ) {}

  private async client() {
    const { S3Client } = await import("@aws-sdk/client-s3");
    return new S3Client({ region: this.region });
  }

  async put({ key, body, contentType }: PutOptions): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    const response = await client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await response.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    try {
      await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

}

/* ---------------------------------------------------------------- factory */

let cached: StorageDriver | undefined;

/** The configured driver: S3 when a bucket is set, otherwise the local filesystem. */
export function storage(): StorageDriver {
  if (cached) return cached;

  const bucket = process.env.S3_BUCKET;
  if (bucket) {
    cached = new S3StorageDriver(bucket, process.env.S3_REGION ?? "us-east-1");
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new Error("S3_BUCKET must be set in production — refusing to store files on local disk");
    }
    cached = new LocalStorageDriver();
  }
  return cached;
}

/** Test seam. */
export function resetStorage(): void {
  cached = undefined;
}
