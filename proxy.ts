import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/src/services/auth/tokens";

/**
 * Redirect convenience only — NOT the security boundary.
 *
 * This runs on every request, so it does no database work: it checks whether a session
 * cookie is merely present and routes accordingly. A forged or expired cookie sails
 * through here and is rejected by `getSession()` inside the page or action, which is
 * where authentication actually happens. (Next.js has a history of middleware-bypass
 * vulnerabilities; nothing may depend on this file for access control.)
 *
 * Renamed from `middleware.ts` — Next.js 16 replaced that convention with `proxy`.
 */
// Public: the marketing landing page, the auth entry points, and the SEO files.
const PUBLIC_PATHS = new Set(["/", "/login", "/signup", "/robots.txt", "/sitemap.xml"]);

/**
 * Shared links (PHASE-12, D-112): opened by people with no account. `/s/` with the slash — a
 * bare `/s` prefix would also match `/signup` today and any `/s…` route added later. Access is
 * decided by the token inside the page and routes, never here.
 */
const SHARED_LINK_PREFIX = "/s/";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);

  const isPublicRoute =
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith(SHARED_LINK_PREFIX);

  // The absence of a cookie definitively means "not signed in", so this redirect is safe
  // and saves a render.
  if (!hasSessionCookie && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // The PRESENCE of a cookie proves nothing — it may be expired, revoked, or forged. This
  // used to redirect cookie-holders away from /login, which produced an infinite loop for
  // anyone whose session had ended: /login sent them to /, the layout found no valid
  // session and sent them back to /login. Bouncing an already-signed-in user off the auth
  // pages needs a real session check, so the pages do it themselves in `getSession()`.

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, the API routes (which authenticate themselves),
  // and static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
