import "server-only";

/**
 * docx → PDF conversion (architecture §Generation pipeline, step 4).
 *
 * The docx is the canonical cover sheet; the PDF the City receives and the pages the packet
 * embeds are both converted from it, so there is one layout to maintain and the two formats
 * cannot drift. LibreOffice does the conversion — the same engine the deployment container
 * ships, so local output matches production.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** A long statement can take a while to lay out; a wedged process must not outlive this. */
const CONVERT_TIMEOUT_MS = 180_000;

export class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversionError";
  }
}

/**
 * Where to find LibreOffice.
 *
 * `soffice` is on `PATH` in the container. On macOS the cask installs into the app bundle
 * and does not link a binary, so the standard location is tried as well rather than making
 * every developer edit their profile.
 */
function candidates(): string[] {
  const configured = process.env.SOFFICE_PATH;
  return [
    ...(configured ? [configured] : []),
    "soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/bin/soffice",
    "/usr/lib/libreoffice/program/soffice",
  ];
}

function run(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new ConversionError(`LibreOffice timed out after ${Math.round(timeoutMs / 1000)}s.`));
      } else if (code !== 0) {
        reject(new ConversionError(`LibreOffice failed (exit ${code}): ${stderr.trim().slice(0, 400)}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Convert a docx to PDF.
 *
 * Each run gets its own profile directory as well as its own working directory: LibreOffice
 * keeps a single-instance lock on its user profile, so two concurrent conversions sharing
 * one would serialise at best and fail at worst.
 */
export async function convertDocxToPdf(docx: Buffer): Promise<Buffer> {
  // LibreOffice sniffs content rather than trusting the extension, and falls back to
  // treating unrecognised input as plain text — so a malformed document converts happily
  // into a PDF of garbage instead of failing. A docx is a zip; checking the magic bytes
  // turns that silent wrong answer into an error before anything reaches the City.
  if (docx.subarray(0, 2).toString() !== "PK") {
    throw new ConversionError("Refusing to convert: that is not a .docx package.");
  }

  const dir = await mkdtemp(path.join(tmpdir(), "ngo-soffice-"));
  try {
    const input = path.join(dir, "cover-sheet.docx");
    const profile = path.join(dir, "profile");
    await writeFile(input, docx);

    const args = [
      "--headless",
      "--norestore",
      "--invisible",
      "--nolockcheck",
      // `pathToFileURL`, not string-concatenated `file://${profile}`: a Windows temp path is
      // backslashed and drive-lettered (`C:\Users\...`), which concatenation turns into a
      // malformed URI — LibreOffice reads the drive letter as a host and starts pointed at a
      // nonsensical profile location, surfacing as "bootstrap.ini is corrupt" on launch. A
      // POSIX temp path already starts with `/`, so the same concatenation happens to produce
      // a valid `file:///...` URI there, which is why this went unnoticed until it ran on
      // Windows for the first time.
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      dir,
      input,
    ];

    let lastError: unknown;
    let converted = false;
    for (const command of candidates()) {
      try {
        await run(command, args, CONVERT_TIMEOUT_MS);
        converted = true;
        break;
      } catch (error) {
        // Only a missing binary is worth trying the next candidate for; a real conversion
        // failure would fail identically everywhere and should surface immediately.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        lastError = error;
      }
    }

    if (!converted) {
      throw new ConversionError(
        "LibreOffice is not installed. The application container ships it; locally, install it " +
          "(`brew install --cask libreoffice`) or set SOFFICE_PATH to the soffice binary. " +
          `Tried: ${candidates().join(", ")}. (${String(lastError)})`,
      );
    }

    const produced = (await readdir(dir)).find((name) => name.endsWith(".pdf"));
    if (!produced) {
      // LibreOffice exits 0 even when it declines to convert, so the output file is the
      // only reliable evidence that anything happened.
      throw new ConversionError("LibreOffice reported success but produced no PDF.");
    }

    const pdf = await readFile(path.join(dir, produced));
    if (pdf.subarray(0, 5).toString() !== "%PDF-") {
      throw new ConversionError("LibreOffice produced a file that is not a PDF.");
    }
    return pdf;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Whether conversion is available, for surfacing a clear message before a long build. */
export async function conversionAvailable(): Promise<boolean> {
  for (const command of candidates()) {
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(command, ["--version"], { stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    });
    if (ok) return true;
  }
  return false;
}
