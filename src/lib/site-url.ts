/**
 * The public origin of the app — what a shared link is built from (PHASE-12 P1, D-112).
 *
 * A share link is built once and emailed, so a wrong or missing domain would only surface in the
 * recipient's inbox. Production therefore refuses to start without a valid `APP_URL`
 * (`instrumentation.ts`, using `appUrlProblem` below); development falls back to the dev server.
 */

const DEVELOPMENT_ORIGIN = "http://localhost:3000";

/** Why a value can't be the app's URL, or null when it can. */
export function appUrlProblem(value: string | undefined): string | null {
  if (!value) return "it is not set";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `"${value}" is not a URL`;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return `"${value}" is not an http(s) address`;
  }
  return null;
}

/** `https://stayfunded360.com` — the origin alone, whatever path or slash `APP_URL` carries. */
export function siteOrigin(): string {
  const value = process.env.APP_URL;
  const problem = appUrlProblem(value);
  if (!problem) return new URL(value!).origin;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`APP_URL must be set in production — ${problem}. Shared links are built from it.`);
  }
  return DEVELOPMENT_ORIGIN;
}
