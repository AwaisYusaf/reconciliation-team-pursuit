/**
 * Web Worker: one HEIC in, one JPEG out (see `heic-to-jpeg.ts`). A worker so decoding a full
 * iPhone photo never freezes the page, and so the decoder's WASM memory — which only ever
 * grows — is released when the caller terminates it after each photo.
 */
import decode from "heic-decode";

/** Standard iPhone photos are 12 or 24 megapixels. Anything larger goes to the server as it is,
 *  rather than asking a phone's browser for several hundred MB. */
const MAX_PIXELS = 25_000_000;

export type HeicWorkerReply = { ok: true; blob: Blob } | { ok: false };

const reply = (message: HeicWorkerReply) => (self as unknown as Worker).postMessage(message);

self.onmessage = async (event: MessageEvent<File>) => {
  let images: Awaited<ReturnType<typeof decode.all>> | undefined;
  try {
    images = await decode.all({ buffer: new Uint8Array(await event.data.arrayBuffer()) });
    const [first] = images;
    // Dimensions come from the header, so an oversized photo is refused before any decode.
    if (!first || first.width * first.height > MAX_PIXELS) return reply({ ok: false });

    const { width, height, data } = await first.decode();
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return reply({ ok: false });
    context.putImageData(new ImageData(data, width, height), 0, 0);
    reply({ ok: true, blob: await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 }) });
  } catch {
    reply({ ok: false });
  } finally {
    images?.dispose();
  }
};
