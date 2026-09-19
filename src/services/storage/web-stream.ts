import type { Readable } from "node:stream";

/**
 * A stored object's Node stream as the web stream a `Response` body needs.
 *
 * Not `Readable.toWeb`, nor the S3 SDK's `transformToWebStream` (built on it): when a visitor
 * disconnects partway through a download, Next cancels the body, and that conversion then throws
 * "Invalid state: Controller is already closed" as an uncaught exception — once per abandoned
 * download of a shared packet (PHASE-12 review). Here the source is read one chunk per pull, which
 * keeps backpressure (a slow visitor never makes the server read ahead), and a cancel only destroys
 * the source; nothing touches the controller after the reader has gone.
 */
export function webStreamFrom(source: Readable): ReadableStream<Uint8Array> {
  const chunks = source[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  let finished = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (finished) return;
        if (next.done) {
          finished = true;
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        // A read that fails after the reader left (the destroy below) is expected, not news.
        if (finished) return;
        finished = true;
        controller.error(error);
      }
    },
    cancel() {
      finished = true;
      source.destroy();
    },
  });
}
