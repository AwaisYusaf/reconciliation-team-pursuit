/**
 * Shared `pdftotext` probing and invocation for the PDF text assertions.
 *
 * Two portability traps sit behind this, and both of them fail *silently* — which is how a
 * broken assertion reached PR #8 review with a green suite on the author's machine:
 *
 * - **Probing.** Xpdf's `pdftotext -v` prints its version banner and exits **99**; Poppler's
 *   exits 0. A probe that only accepted exit 0 therefore reported "not installed" on every
 *   Xpdf machine — including Git for Windows, whose bundled `pdftotext` is Xpdf 4.00 — so
 *   `describe.skipIf(!hasPdftotext())` skipped the whole block rather than running it. Probe
 *   for the banner, not the exit code, so either implementation counts as present.
 * - **Encoding.** Xpdf defaults its output to Latin-1, Poppler to UTF-8, so an em dash in the
 *   R7.3 context line came back as `?` under Xpdf and three assertions failed for a reason
 *   that had nothing to do with the PDF. `-enc UTF-8` is understood by both, and makes the
 *   extracted text identical whichever one is installed.
 *
 * Both live here rather than in each suite because all four PDF-text suites had their own
 * copy of the probe, so a fix in one left the other three still skipping.
 */
import { execFileSync, spawnSync } from "node:child_process";

/** Whether a usable `pdftotext` — Poppler *or* Xpdf — is on PATH. */
export function hasPdftotext(): boolean {
  // spawnSync doesn't throw on a non-zero exit, so Xpdf's 99 is observable rather than fatal;
  // `error` is set only when the binary genuinely isn't there.
  const probe = spawnSync("pdftotext", ["-v"], { encoding: "utf8" });
  return !probe.error && /pdftotext version/i.test(`${probe.stdout ?? ""}${probe.stderr ?? ""}`);
}

/** `pdftotext` with UTF-8 output forced, so Xpdf and Poppler return the same characters. */
export function pdftotext(args: readonly string[]): string {
  return execFileSync("pdftotext", ["-enc", "UTF-8", ...args], { encoding: "utf8" });
}
