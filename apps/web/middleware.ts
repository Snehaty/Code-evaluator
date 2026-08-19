// apps/web/middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { scopedCookieNames } from "./lib/auth/cookies";

/**
 * Unauthenticated redirects ONLY. No authorization of any kind.
 *
 * Middleware runs on Edge on Vercel and in Node self-hosted; keeping every rule
 * out of it removes the largest behavioural difference between the two
 * deployment targets this project keeps open. A cookie's PRESENCE is not proof
 * it is valid — the real check happens in the services, which is why this file
 * can be this dumb without being unsafe.
 */
const SESSION_COOKIES = [
  scopedCookieNames("dev").sessionToken.name,
  scopedCookieNames("sh").sessionToken.name,
];

export function middleware(req: NextRequest): NextResponse {
  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const login = new URL("/login", req.url);
  login.searchParams.set("from", req.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/projects/:path*", "/requirements/:path*"],
};
