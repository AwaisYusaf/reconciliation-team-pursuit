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
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);

  const isAuthRoute =
    pathname === "/login" || pathname === "/signup" || pathname.startsWith("/onboarding");

  if (!hasSessionCookie && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (hasSessionCookie && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, the API routes (which authenticate themselves),
  // and static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
