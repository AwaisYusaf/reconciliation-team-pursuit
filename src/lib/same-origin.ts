/**
 * Origin check for a cookie-authenticated mutation outside a Server Action (architecture
 * §Auth). Server Actions get this from Next.js automatically; route handlers — the upload and
 * read-amounts routes — have to do it themselves.
 */
export function sameOrigin(request: { headers: { get(name: string): string | null } }): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}
