"use client";

/**
 * Converts a picked HEIC (iPhone photo) to JPEG in the browser, so it previews before the
 * expense is saved — Chrome and Edge cannot display HEIC at all. The upload and the AI read then
 * carry an ordinary JPEG too. Nothing depends on it succeeding: a file that fails, is too large
 * or takes too long is queued as the original HEIC, and the server converts it on upload.
 *
 * Runs in a fresh worker per photo (`heic-worker.ts`), terminated afterwards: the page never
 * blocks on a decode, and the decoder's memory is handed back each time. The ~2 MB decoder is
 * only downloaded once someone actually picks a HEIC.
 */
import type { HeicWorkerReply } from "./heic-worker";

/** Well past a real photo's decode; a worker that hasn't answered by then is stuck. */
const CONVERT_TIMEOUT_MS = 30_000;

/** Chrome on Windows gives a .heic no type at all, so the extension is the only clue there. */
export function looksLikeHeic(file: File): boolean {
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  return file.type === "" && /\.hei[cf]$/i.test(file.name);
}

/** The JPEG version of `file`, or `file` itself if it can't be converted here. Never rejects. */
export function heicToJpegFile(file: File): Promise<File> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./heic-worker.ts", import.meta.url), { type: "module" });
    } catch {
      return resolve(file);
    }
    const finish = (result: File) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish(file), CONVERT_TIMEOUT_MS);
    worker.onerror = () => finish(file);
    worker.onmessage = (event: MessageEvent<HeicWorkerReply>) => {
      if (!event.data.ok) return finish(file);
      const name = `${file.name.replace(/\.hei[cf]$/i, "")}.jpg`;
      finish(new File([event.data.blob], name, { type: "image/jpeg", lastModified: file.lastModified }));
    };
    worker.postMessage(file);
  });
}
