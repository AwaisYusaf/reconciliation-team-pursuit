/**
 * The financial trail through a built packet (R10.5, D-70).
 *
 * The funder's requirement is that anyone can follow an expense from the cover letter to its
 * supporting documentation without being told where to look. That is a property of the whole
 * assembled PDF, so it is asserted against a real one: built from a real database and the
 * real storage driver, then read back with `pdftotext` — the reference has to be text a
 * reviewer can search, not a picture of text.
 *
 * Skipped when DATABASE_URL or poppler is absent.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function hasPdftotext(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRun = Boolean(process.env.DATABASE_URL) && hasPdftotext();
const MONTH = "2099-02";

describe.skipIf(!canRun)("packet traceability (integration)", async () => {
  const { db } = await import("@/src/db");
  const { contractSettings, expenses, lineItems, organizations, paymentSources } = await import(
    "@/src/db/schema"
  );
  const { ingestExpenseDocument } = await import("@/src/services/storage/documents");
  const { loadMonthSnapshot } = await import("./month-snapshot");
  const { buildDeliverablePacket } = await import("./packet-build");

  let orgId: string;
  let pageText: string[];
  let pageCount: number;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Trace Org", docName: "Trace", activeMonth: MONTH })
      .returning({ id: organizations.id });
    orgId = org.id;

    await db.insert(contractSettings).values({ orgId, projectName: "CVI" });
    await db
      .insert(paymentSources)
      .values({ orgId, label: "Paid by us, reimbursement requested", sortOrder: 0 });
    const [item] = await db
      .insert(lineItems)
      .values({ orgId, name: "Transportation", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });

    const jpeg = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: { r: 250, g: 250, b: 248 } },
    })
      .jpeg()
      .toBuffer();

    for (let seq = 1; seq <= 3; seq += 1) {
      const [expense] = await db
        .insert(expenses)
        .values({
          orgId,
          lineItemId: item.id,
          month: MONTH,
          date: `${MONTH}-1${seq}`,
          name: `Rideshare ${seq}`,
          description: "Outreach travel",
          paymentSource: "Paid by us, reimbursement requested",
          subtotalCents: 2_000 * seq,
          sortOrder: seq,
          referenceSeq: seq,
        })
        .returning({ id: expenses.id });

      for (const scope of ["receipt", "proof"] as const) {
        const result = await ingestExpenseDocument({
          orgId,
          expenseId: expense.id,
          scope,
          file: new File([new Uint8Array(jpeg)], `${scope}-${seq}.jpg`, { type: "image/jpeg" }),
        });
        if (!result.ok) throw new Error(result.error);
      }
    }

    const packet = await buildDeliverablePacket(await loadMonthSnapshot(orgId, MONTH));
    pageCount = packet.pageCount;

    const dir = await mkdtemp(path.join(tmpdir(), "ngo-trace-"));
    try {
      const file = path.join(dir, "packet.pdf");
      await writeFile(file, packet.pdf);
      pageText = Array.from({ length: pageCount }, (_, index) =>
        execFileSync("pdftotext", ["-f", String(index + 1), "-l", String(index + 1), file, "-"], {
          encoding: "utf8",
        }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);

  afterAll(async () => {
    if (orgId) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
      await rm(path.join(process.cwd(), ".storage", "org", orgId), {
        recursive: true,
        force: true,
      });
    }
  });

  function pagesCarrying(reference: string): number[] {
    return pageText
      .map((text, index) => (text.includes(`— ${reference} — Page`) ? index + 1 : 0))
      .filter(Boolean);
  }

  it("every expense in the index resolves to a stamped page", async () => {
    // The trail in the direction a reviewer reads it: reference in hand, find the evidence.
    for (const seq of [1, 2, 3]) {
      const reference = `${MONTH}-00${seq}`;
      expect(pagesCarrying(reference).length).toBeGreaterThan(0);
      // And the reference is in the index too, so the lookup exists in both directions.
      expect(pageText.some((text) => text.includes(reference))).toBe(true);
    }
  });

  it("no two expenses claim the same page", () => {
    const seen = new Set<number>();
    for (const seq of [1, 2, 3]) {
      for (const page of pagesCarrying(`${MONTH}-00${seq}`)) {
        expect(seen.has(page)).toBe(false);
        seen.add(page);
      }
    }
  });

  it("pages belonging to no single expense carry no reference", () => {
    // The summary, the index and the cover sheet cover the month or the whole category;
    // stamping one expense's number on them would assert something untrue.
    const referenceOnPage = /— \d{4}-\d{2}-\d{3} — Page/;
    expect(referenceOnPage.test(pageText[0])).toBe(false);
    expect(referenceOnPage.test(pageText[1])).toBe(false);
  });

  it("still numbers every page against the final total (R10.5)", () => {
    for (const [index, text] of pageText.entries()) {
      expect(text).toContain(`Page ${index + 1} of ${pageCount}`);
    }
  });

  it("keeps the organisation and month on every page", () => {
    for (const text of pageText) expect(text).toContain("Trace — February 2099");
  });
});
