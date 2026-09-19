import "server-only";

/**
 * HEIC → raw RGBA, decoded off the main thread (PR #18 round 2, #4).
 *
 * The sharp build npm installs has no HEVC decoder, so iPhone photos go through libheif's WASM
 * build (`heic-decode`). Three things make running it in-process wrong: a decode blocks the event
 * loop for its whole duration; the WASM memory it grows is never handed back to the process; and
 * the size a caller can read up front (sharp's metadata, the *primary* image) need not be the
 * image `heic-decode` actually decodes (the *first* one), so a crafted file could pass a size
 * check it never met. Each decode therefore runs in its own worker thread — which reads the size
 * of the very image it is about to decode, and is terminated afterwards, taking its memory with
 * it — with at most `MAX_CONCURRENT_DECODES` running at once across the whole server.
 *
 * The worker is inline source (`eval: true`) that `require`s `heic-decode` from `node_modules`,
 * rather than a separate file: Next bundles server code, and a worker file's path does not
 * survive that; `heic-decode` is in `serverExternalPackages`, so it is always on disk.
 */
import { Worker } from "node:worker_threads";

/** iPhone photos are 12 or 24 MP; the same limit the browser converts under. */
export const HEIC_MAX_PIXELS = 25_000_000;
/** Each decode can hold ~100 MB of RGBA and decoder state at 25 MP. */
const MAX_CONCURRENT_DECODES = 2;
/** Well past a real photo's decode; a worker that hasn't answered by then is stuck. */
const DECODE_TIMEOUT_MS = 30_000;

export type DecodedHeic = { width: number; height: number; data: Uint8Array };

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const decode = require("heic-decode");
(async () => {
  const images = await decode.all({ buffer: workerData.buffer });
  try {
    const image = images[0];
    if (!image) throw new Error("no image in the file");
    // The size of the image decoded below, from its own handle, never another image's.
    if (image.width * image.height > workerData.maxPixels) {
      parentPort.postMessage({ tooLarge: true });
      return;
    }
    const { width, height, data } = await image.decode();
    parentPort.postMessage({ width, height, data }, [data.buffer]);
  } finally {
    images.dispose();
  }
})().catch((error) => parentPort.postMessage({ error: String((error && error.message) || error) }));
`;

/** A counting semaphore: `run` waits until fewer than `limit` tasks are running. */
export function createLimiter(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return {
    get running() {
      return running;
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
      running += 1;
      try {
        return await task();
      } finally {
        running -= 1;
        waiting.shift()?.();
      }
    },
  };
}

const decodes = createLimiter(MAX_CONCURRENT_DECODES);

function decodeInWorker(body: Buffer, maxPixels: number): Promise<DecodedHeic> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { buffer: new Uint8Array(body), maxPixels },
    });
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      void worker.terminate();
      settle();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("HEIC decode timed out"))), DECODE_TIMEOUT_MS);
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", () => finish(() => reject(new Error("HEIC decoder exited"))));
    worker.once("message", (message: { tooLarge?: true; error?: string } & Partial<DecodedHeic>) => {
      if (message.tooLarge) return finish(() => reject(new Error("pixel limit exceeded")));
      if (message.error || !message.data || !message.width || !message.height) {
        return finish(() => reject(new Error(message.error ?? "HEIC decode failed")));
      }
      const { width, height, data } = message;
      finish(() => resolve({ width, height, data }));
    });
  });
}

/** Rejects with a message containing "pixel limit" when the image is over `maxPixels`. */
export function decodeHeic(body: Buffer, maxPixels = HEIC_MAX_PIXELS): Promise<DecodedHeic> {
  return decodes.run(() => decodeInWorker(body, maxPixels));
}
