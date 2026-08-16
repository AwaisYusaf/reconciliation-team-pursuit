# Adversarial review — cover sheet & packet generators

Scope: the cover sheet composer and docx generator, LibreOffice conversion, rasterization,
packet assembly and ordering, the packet's summary section, footers and the size ladder, and
both download routes.

Every finding was reproduced before being accepted. Two were critical — each turned a
document going to the City into something wrong or unobtainable — and both are fixed with
regression tests that reproduce the original failure.

## Critical

### C1 — the oversize packet was the one packet that could never be downloaded

`oversizeWarning()` contains an em dash and a curly apostrophe. HTTP header values are
ByteStrings, so putting it in `X-Packet-Warning` made constructing the response throw
`TypeError: Cannot convert argument to a ByteString`. The throw sat *outside* the route's
`try/catch`, so it surfaced as a bare 500 — and because the artifact had already been built,
uploaded and pinned, every retry failed identically. Forever.

This exactly inverted the rule it was implementing: packet-pdf-spec §Size says an oversize
packet is *delivered anyway* and that the download is **never** blocked on size. The only
path the spec insists must always succeed was the only one guaranteed to fail.

**Fixed.** The header value is percent-encoded, and the client decodes it and shows a warning
toast — the warning previously had no consumer at all, so even a working header would have
been invisible. A test now puts the real warning through a real `Response` and asserts the
raw form throws while the encoded form round-trips.

### C2 — a page of evidence could silently become a blank page

`pdftoppm` exits 0 while emitting a 1×1 pixel JPEG for absurd page geometry, and can exit 0
having rendered only some pages. `rasterizePdf` checked only that *some* file appeared. A 1×1
image scaled to a Letter page is an invisible speck: the packet gains a blank page where a
receipt should be, with no error, nothing logged, the gate satisfied and the page count
unchanged. Reachable with a legitimate 1.3 KB PDF that upload inspection accepts.

**Fixed.** Rasterization now takes the page count recorded at attach time and refuses when
fewer pages render, and rejects any page smaller than 16px as not a readable page. Both are
regression-tested, the second against a real 200-inch-square PDF.

## High

| # | Finding | Disposition |
|---|---|---|
| H1 | `StandardFonts.Helvetica` is WinAnsi-only and pdf-lib *throws* on anything outside it. A non-breaking hyphen or zero-width space — both invisible, both routinely carried along when text is pasted from Word — in the organisation's document name or a line item name aborted every packet build permanently, with an error pointing nowhere near Settings. | **Fixed.** `winAnsiSafe` folds text to the closest representable form: typographic punctuation to ASCII, stroked letters (Ł, Đ) to their base letter, accents decomposed, invisible characters dropped, anything else to `?`. Verified end to end — a document name containing both characters now produces a normal 91-page packet reading "Team-PursuitGlobal". |
| H2 | Peak memory is roughly 3× the output, not "one page at a time" as the module claimed: `rasterizePdf` streams, but `embedJpg` retains every image until `save()`. Two gratuitous full copies compounded it. | **Partly fixed.** Both `Buffer.from(await pdf.save())` copies are gone — `save()` already returns a fresh array, so the buffer is wrapped rather than duplicated. The underlying linear growth is inherent to pdf-lib and is recorded below. The misleading comment is corrected. |
| H3 | The org-mismatch guards in `appendUpload` and `imagesFor` returned early, **silently omitting** the document from the claim. | **Fixed** — both throw. A guard whose purpose is to detect misfiled evidence must fail closed; dropping the file is the worst of the available outcomes. |
| H4 | `buildCoverSheetDocx` indexed `images[index] ?? []`, so a short array would render headings with no proofs beneath them — a sheet that looks complete and documents nothing. | **Fixed** — the row/image alignment is asserted, not assumed. |

## Medium and low

| # | Finding | Disposition |
|---|---|---|
| M1 | Image dimensions were captured *before* `.rotate()`, so a phone photo with EXIF orientation 5–8 was recorded with its axes swapped. The page estimator then fitted a portrait image into a landscape box — a ~1.6× error per image, enough to break the ±2 page tolerance. | **Fixed** — quarter-turn orientations transpose the recorded dimensions. |
| M2 | The packet summary's context subtitle is 592 pt wide when every setting is populated, against a 540 pt content width. Centred, it started 0.14" from the paper edge and longer identifiers ran off the sheet. | **Fixed** — it wraps, using the same helper the table already used. |
| L1 | `CATEGORY_ORDER.indexOf` returns −1 for an unknown category, sorting it *ahead of the bank statement* at the front of the packet. Unreachable today; a future enum value would silently reorder the submission. | **Fixed** — unknown categories sort last. |
| L2 | `fitWithin` returned the whole box for a zero-dimension source, inventing an aspect ratio and stretching the image. | **Fixed** — returns a square, which is honest about knowing nothing. |
| L3 | The temp-directory cleanup test sampled a shared global prefix once, so it failed whenever another test file converted concurrently. | **Fixed** — it waits for the difference to clear, which a leaked directory never does. |

## Accepted, with reasons

- **Money, the gate, and tenant isolation were checked and found sound.** The cover sheet
  total, the packet's "This Period", the workbook and the screen all resolve to the same sum
  over the same array; `loadMonthSnapshot` derives `amounts` from the rows it returns rather
  than a second query, so they cannot diverge. Both routes re-evaluate the gate against the
  live snapshot before touching the cache, and deleting a proof changes the hash as well as
  closing the gate, so a stale artifact cannot outrun it. Every query carries `orgId`.
- **CMYK, progressive and PNG-mislabelled JPEGs** were tested against `embedJpg` and all
  convert correctly.

## Deferred, with reasons

These are real and recorded rather than fixed, because each is a change to how generation is
scheduled rather than to what it produces:

- **Single-flight lock per (org, month, type)** — specified in the architecture, absent.
  Two clicks on Download Packet run two full builds. Outputs are deterministic so the result
  is correct either way; the cost is duplicated CPU and memory on a container shared with
  Postgres.
- **Rate limiting on generation** — `LIMITS.generate` exists and has no caller. A signed-in
  user can request every month key in a loop.
- **A wall-clock bound on a whole build** — only per-child timeouts exist. `maxDuration` is
  platform metadata that `next start` does not enforce.
- **Memory is linear in packet size** (~3× the output) because pdf-lib holds every embedded
  image until `save()`. Bounding it properly means streaming assembly or a page cap.
- **The size ladder rebuilds the entire packet per step**, re-running LibreOffice once per
  line item each time — up to 3× the whole build for an oversize month.
- **`MAX_PACKET_BYTES` and `RASTER_LADDER` are not part of the cache key.** Changing either
  without bumping `GENERATOR_VERSION` would serve old-quality bytes forever, since pinned
  rows are never replaced.

All six matter for a large month. None affects the correctness of what a successful build
produces, which is why they are sequenced after the remaining feature work rather than before
it.
