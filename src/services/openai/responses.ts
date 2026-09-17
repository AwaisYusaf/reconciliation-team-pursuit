import "server-only";

/**
 * Shared OpenAI Responses API helpers (Phase 10 §3.3, Phase 11 §5).
 *
 * Split out of `read-amounts.ts` so `write-summary.ts` doesn't reimplement the same envelope:
 * usage extraction, the `completed`/refusal/incomplete walk to the model's `output_text`, and
 * cost-in-micro-USD from a feature's two price-per-million-token env settings.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** `usage.input_tokens`/`usage.output_tokens` from a Responses API body, or `null` when absent. */
export function readUsage(json: unknown): { inputTokens: number | null; outputTokens: number | null } {
  const usage = isRecord(json) && isRecord(json.usage) ? json.usage : null;
  const inputTokens = usage && typeof usage.input_tokens === "number" ? usage.input_tokens : null;
  const outputTokens = usage && typeof usage.output_tokens === "number" ? usage.output_tokens : null;
  return { inputTokens, outputTokens };
}

/**
 * Walks a Responses API body to the model's `output_text`. `null` on a top-level status other
 * than `completed`, on an output item whose own status isn't `completed`, on a refusal part, or
 * when no `output_text` part is present at all — the same "nothing usable came back" rule every
 * caller (receipt reading, monthly summaries) treats as a failed run.
 */
export function completedOutputText(json: unknown): string | null {
  if (isRecord(json) && typeof json.status === "string" && json.status !== "completed") return null;

  const output = isRecord(json) && Array.isArray(json.output) ? json.output : null;
  if (!output) return null;

  let outputText: string | null = null;
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (typeof item.status === "string" && item.status !== "completed") return null;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (part.type === "refusal") return null;
      if (part.type === "output_text" && typeof part.text === "string") outputText = part.text;
    }
  }
  return outputText;
}

const PRICE_ENV: Record<"read" | "summary", { input: string; output: string }> = {
  read: { input: "OPENAI_READ_PRICE_INPUT_PER_MTOK", output: "OPENAI_READ_PRICE_OUTPUT_PER_MTOK" },
  summary: {
    input: "OPENAI_SUMMARY_PRICE_INPUT_PER_MTOK",
    output: "OPENAI_SUMMARY_PRICE_OUTPUT_PER_MTOK",
  },
};

/**
 * Cost in micro-USD from token counts and `feature`'s two optional price-per-million-token env
 * settings (Phase 10 §3.3, §3.8; Phase 11 §5). `null` when either token count or either price is
 * missing — usage is still logged, cost simply isn't computed.
 */
export function costMicroUsd(
  inputTokens: number | null,
  outputTokens: number | null,
  env: NodeJS.ProcessEnv = process.env,
  feature: "read" | "summary" = "read",
): number | null {
  if (inputTokens === null || outputTokens === null) return null;

  const { input, output } = PRICE_ENV[feature];
  const inputPrice = toPositiveNumber(env[input]);
  const outputPrice = toPositiveNumber(env[output]);
  if (inputPrice === null || outputPrice === null) return null;

  // price is dollars per 1,000,000 tokens; micro-USD is 1e-6 dollars, so tokens * price is
  // already micro-USD per token-million cancelled against the 1e6 token unit.
  const micro = inputTokens * inputPrice + outputTokens * outputPrice;
  return Math.round(micro);
}

function toPositiveNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
