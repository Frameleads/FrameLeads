import { NextRequest, NextResponse } from "next/server";

/**
 * Next.js Edge Middleware — Session Gatekeeping
 *
 * Intercepts all requests to /dashboard/* and checks for the
 * presence of the `frameleads_session` HTTP-only cookie.
 *
 * If the cookie is missing, the user is redirected to /login.
 * Otherwise, the request proceeds normally.
 */

export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get("frameleads_session");

  if (!sessionCookie?.value) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
