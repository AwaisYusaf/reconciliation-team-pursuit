import { UI } from "@/src/domain/strings";

export type UnlockAnswer = { ok: true; url: string } | { ok: false; error: string };

/**
 * What the unlock route's answer means for the visitor. The route words every refusal it
 * expects; anything else (a proxy error page, a crash) becomes the same plain "can't be opened
 * right now" rather than a developer message or a JSON parse error.
 */
export async function readUnlockAnswer(response: Response): Promise<UnlockAnswer> {
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson) return { ok: false, error: UI.shareOpenFailed };
  try {
    const body = (await response.json()) as Partial<{ ok: boolean; url: string; error: string }>;
    if (body.ok === true && typeof body.url === "string" && body.url.startsWith("/s/")) {
      return { ok: true, url: body.url };
    }
    if (body.ok === false && typeof body.error === "string") return { ok: false, error: body.error };
  } catch {
    // Falls through.
  }
  return { ok: false, error: UI.shareOpenFailed };
}
