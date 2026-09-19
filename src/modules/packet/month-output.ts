import "server-only";

/**
 * The month's two deliverables — the packet PDF and the summary workbook — gated and built
 * one way, whether they are downloaded or shared by link (PHASE-12 P11).
 *
 * The download routes used to carry this sequence twice, and sharing would have made it three
 * copies of one gate. A gate kept in several places drifts, so the checks, their order and their
 * wording live here; each caller keeps only what is its own (session, origin, rate limit, and
 * how the result is answered).
 */
import { monthLabel, type MonthKey } from "@/src/domain/dates";
import { blockingRecords } from "@/src/domain/gate";
import { packetFilename, UI } from "@/src/domain/strings";
import { ensureArtifact, resolveArtifact, type ResolveArtifactInput } from "@/src/generation/artifacts";
import { artifactTypeOf, type SharedArtifactType, type SharedFileKind } from "@/src/domain/shared-links";
import { inputsHash, recordsHash } from "@/src/generation/cache-key";
import { gateExpenses, loadMonthSnapshot, type MonthSnapshot } from "@/src/generation/month-snapshot";
import { buildDeliverablePacket } from "@/src/generation/packet-build";
import { PacketError } from "@/src/generation/packet-pdf";
import { buildSummaryWorkbook, summaryWorkbookName } from "@/src/generation/summary-xlsx";
import { PACKET_GENERATOR_VERSION, SUMMARY_GENERATOR_VERSION } from "@/src/generation/versions";
import { deletedItemsRefusal, loadTrashedExpenses } from "@/src/modules/expenses/queries";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";

export type MonthOutputKind = SharedFileKind;

type MonthOutputSpec = {
  type: SharedArtifactType;
  extension: "pdf" | "xlsx";
  generatorVersion: string;
  build: (snapshot: MonthSnapshot) => Promise<Buffer>;
  filename: (snapshot: MonthSnapshot, month: MonthKey, sourceName: string | undefined) => string;
};

export const MONTH_OUTPUTS: Record<MonthOutputKind, MonthOutputSpec> = {
  packet: {
    type: artifactTypeOf("packet"),
    extension: "pdf",
    generatorVersion: PACKET_GENERATOR_VERSION,
    build: async (snapshot) => (await buildDeliverablePacket(snapshot)).pdf,
    filename: (snapshot, month, sourceName) =>
      packetFilename(snapshot.docName, monthLabel(month), sourceName),
  },
  summary: {
    type: artifactTypeOf("summary"),
    extension: "xlsx",
    generatorVersion: SUMMARY_GENERATOR_VERSION,
    build: (snapshot) => buildSummaryWorkbook(snapshot),
    filename: (snapshot, month, sourceName) =>
      summaryWorkbookName(snapshot.docName, month, sourceName),
  },
};

/** The output's cache key for a snapshot — what decides whether its saved file is current. */
export function monthOutputHash(kind: MonthOutputKind, snapshot: MonthSnapshot): string {
  return inputsHash({ snapshot, generatorVersion: MONTH_OUTPUTS[kind].generatorVersion });
}

/**
 * The records one output is built from, hashed without any generator version — what a shared
 * file's "Your records changed" notice compares (PHASE-12 P14).
 *
 * The packet reads the whole snapshot. The summary workbook reads no documents — neither an
 * expense's receipts and proofs nor the month documents — so a late receipt or a bank statement
 * must not flag a shared workbook whose figures are unchanged (PHASE-12 review).
 */
export function monthOutputRecordsHash(kind: MonthOutputKind, snapshot: MonthSnapshot): string {
  if (kind === "packet") return recordsHash(snapshot);
  return recordsHash({
    ...snapshot,
    monthDocuments: [],
    expenses: snapshot.expenses.map((expense) => ({ ...expense, documents: [] })),
  });
}

export type PreparedMonthOutput = {
  ok: true;
  kind: MonthOutputKind;
  orgId: string;
  fundingSourceId: string;
  month: MonthKey;
  snapshot: MonthSnapshot;
  hash: string;
  filename: string;
};

/** A deliberate, worded refusal — answered as-is, never logged as a fault. */
export type MonthOutputRefusal = { ok: false; status: 409; message: string };

/**
 * Run every check a month's deliverable must pass, in the order the download routes always
 * have: the deleted-items confirmation, then the documentation gate (R4.3).
 *
 * The confirmation is re-checked here rather than trusted from the dialog: a promise enforced
 * only in the browser is not enforced. A month with no expenses passes the gate on purpose, so
 * a period in which nothing was spent can still be submitted.
 */
export async function prepareMonthOutput(input: {
  orgId: string;
  source: { id: string; name: string };
  month: MonthKey;
  kind: MonthOutputKind;
  confirmedDeletions: boolean;
}): Promise<PreparedMonthOutput | MonthOutputRefusal> {
  const { orgId, source, month, kind } = input;

  const deletedThisMonth = await loadTrashedExpenses(orgId, source.id, month);
  if (deletedThisMonth.length > 0 && !input.confirmedDeletions) {
    return { ok: false, status: 409, message: deletedItemsRefusal(deletedThisMonth) };
  }

  const snapshot = await loadMonthSnapshot(orgId, source.id, month);

  // Filenames gain the source name only once the organisation has more than one source (R10.3).
  const { single } = await loadSourceContext(orgId, null);

  const blocking = blockingRecords(gateExpenses(snapshot.expenses));
  if (blocking.length > 0) {
    return {
      ok: false,
      status: 409,
      message:
        `${blocking.length} ${blocking.length === 1 ? "expense is" : "expenses are"} missing documentation:\n` +
        blocking.map((record) => `• ${record.label}`).join("\n"),
    };
  }

  return {
    ok: true,
    kind,
    orgId,
    fundingSourceId: source.id,
    month,
    snapshot,
    hash: monthOutputHash(kind, snapshot),
    filename: MONTH_OUTPUTS[kind].filename(snapshot, month, single ? undefined : source.name),
  };
}

function artifactInput(prepared: PreparedMonthOutput): ResolveArtifactInput {
  const spec = MONTH_OUTPUTS[prepared.kind];
  return {
    orgId: prepared.orgId,
    fundingSourceId: prepared.fundingSourceId,
    month: prepared.month,
    type: spec.type,
    extension: spec.extension,
    hash: prepared.hash,
    build: () => spec.build(prepared.snapshot),
  };
}

/** Build or reuse the output and return its bytes — the download path. Pins what it serves. */
export function resolveMonthOutput(prepared: PreparedMonthOutput) {
  return resolveArtifact(artifactInput(prepared));
}

/** Build or reuse the output without reading it back — the sharing path. Pins it. */
export function ensureMonthOutput(prepared: PreparedMonthOutput) {
  return ensureArtifact(artifactInput(prepared));
}

/**
 * The message for a genuine generation fault. The screen shows whatever text comes back, so it
 * gets something actionable rather than a generic 500; the detail goes to the log instead.
 */
export function monthOutputFailureMessage(kind: MonthOutputKind, error: unknown): string {
  const tryAgain = `Try again, and if it keeps failing, contact support at ${UI.supportEmail}.`;
  if (kind === "summary") return `The Excel summary couldn't be generated. ${tryAgain}`;
  // PacketError names the section or file that failed, which is what the screen shows.
  const at = error instanceof PacketError ? error.at : null;
  return at
    ? `The packet couldn't be generated. It failed at ${at}. ${tryAgain}`
    : `The packet couldn't be generated. ${tryAgain}`;
}

/**
 * The answer once the organisation's generation budget (`generate`) is spent — the same words
 * whether the file was being downloaded or shared.
 */
export function generationBudgetMessage(retryAfterSeconds: number): string {
  return `Too many documents requested at once. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`;
}
