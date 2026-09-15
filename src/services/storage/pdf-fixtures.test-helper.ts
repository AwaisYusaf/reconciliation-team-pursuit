/**
 * Hand-rolled RC4/R3 Standard-security-handler PDF encryptor, test-only.
 *
 * pdf-lib cannot encrypt, so the owner-password-only and user-password fixtures the inspection
 * tests need don't exist anywhere else in the toolchain here. This implements just enough of
 * the PDF 1.7 spec (§7.6.3, algorithms 3.2–3.5, RC4 128-bit, revision 3) to build a minimal
 * single-page encrypted PDF with a correct `/O` and `/U`, which is all `pdfinfo` and pdf-lib
 * need to tell an owner-password-only file apart from one that genuinely needs a password.
 *
 * Node's OpenSSL build here rejects `rc4` via `crypto.createCipheriv` (legacy cipher, disabled
 * by default), so RC4 is implemented directly — it's a dozen lines and has no dependency on
 * which OpenSSL providers are enabled wherever the suite runs.
 */
import { createHash } from "node:crypto";

const PAD = Buffer.from(
  "28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A",
  "hex",
);
const KEY_LENGTH_BYTES = 16; // 128-bit
const REVISION = 3;

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k += 1) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

function md5(data: Buffer): Buffer {
  return createHash("md5").update(data).digest();
}

function pad32(password: string): Buffer {
  const truncated = Buffer.from(password, "latin1").subarray(0, 32);
  return Buffer.concat([truncated, PAD], 32);
}

function xorKey(key: Buffer, n: number): Buffer {
  return Buffer.from(key.map((b) => b ^ n));
}

/** Algorithm 3.3 — the `/O` entry. */
function computeO(ownerPassword: string, userPassword: string): Buffer {
  let hash = md5(pad32(ownerPassword));
  for (let i = 0; i < 50; i += 1) hash = md5(hash.subarray(0, KEY_LENGTH_BYTES));
  const rc4Key = hash.subarray(0, KEY_LENGTH_BYTES);

  let encrypted = rc4(rc4Key, pad32(userPassword));
  for (let i = 1; i <= 19; i += 1) encrypted = rc4(xorKey(rc4Key, i), encrypted);
  return encrypted;
}

/** Algorithm 3.2 — the file encryption key, derived from the user password. */
function computeEncryptionKey(userPassword: string, o: Buffer, p: number, id0: Buffer): Buffer {
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(p);
  let hash = md5(Buffer.concat([pad32(userPassword), o, pBytes, id0]));
  for (let i = 0; i < 50; i += 1) hash = md5(hash.subarray(0, KEY_LENGTH_BYTES));
  return hash.subarray(0, KEY_LENGTH_BYTES);
}

/** Algorithm 3.5 — the `/U` entry (revision 3+: only the first 16 bytes are validated). */
function computeU(encryptionKey: Buffer, id0: Buffer): Buffer {
  let encrypted = rc4(encryptionKey, md5(Buffer.concat([PAD, id0])));
  for (let i = 1; i <= 19; i += 1) encrypted = rc4(xorKey(encryptionKey, i), encrypted);
  return Buffer.concat([encrypted, Buffer.alloc(16)], 32);
}

function hex(buffer: Buffer): string {
  return `<${buffer.toString("hex")}>`;
}

/**
 * A minimal single-page encrypted PDF, RC4-128 revision 3. `ownerPassword` is the real owner
 * password (permissions); `userPassword` is what a viewer is prompted for — leave it empty to
 * build an owner-password-only fixture, which every viewer opens without a prompt.
 */
export function makeEncryptedPdf(options: { ownerPassword: string; userPassword: string }): Buffer {
  const { ownerPassword, userPassword } = options;
  const id0 = Buffer.from("0123456789abcdef0123456789abcdef", "hex").subarray(0, 16);
  const p = -3904; // fully restrictive; the exact value is unchecked by these tests

  const o = computeO(ownerPassword, userPassword);
  const encryptionKey = computeEncryptionKey(userPassword, o, p, id0);
  const u = computeU(encryptionKey, id0);

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>",
    `<< /Filter /Standard /V 2 /R ${REVISION} /Length 128 /O ${hex(o)} /U ${hex(u)} /P ${p} >>`,
  ];

  const header = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1");
  const chunks: Buffer[] = [header];
  const offsets: number[] = [];
  let position = header.length;

  objects.forEach((body, index) => {
    offsets.push(position);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, "latin1");
    chunks.push(chunk);
    position += chunk.length;
  });

  const xrefOffset = position;
  const entries = ["0000000000 65535 f\r\n", ...offsets.map((o2) => `${String(o2).padStart(10, "0")} 00000 n\r\n`)];
  const xref = Buffer.from(
    `xref\n0 ${objects.length + 1}\n${entries.join("")}` +
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [${hex(id0)} ${hex(id0)}] >>\n` +
      `startxref\n${xrefOffset}\n%%EOF`,
    "latin1",
  );
  chunks.push(xref);

  return Buffer.concat(chunks);
}
