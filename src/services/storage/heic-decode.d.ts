/** `heic-decode` ships no types; only the calls this repo makes are declared. */
declare module "heic-decode" {
  type Input = { buffer: ArrayBuffer | Uint8Array };
  type Decoded = { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> };
  type Image = { width: number; height: number; decode(): Promise<Decoded> };

  interface Decode {
    /** Decodes the primary image and frees the decoder. */
    (input: Input): Promise<Decoded>;
    /** Every image with its header dimensions, undecoded; the caller must `dispose()`. */
    all(input: Input): Promise<Image[] & { dispose(): void }>;
  }

  const decode: Decode;
  export default decode;
}
