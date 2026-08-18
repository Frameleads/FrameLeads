import { NextResponse } from "next/server";
import {
  createWhopAuthorizationUrl,
  getWhopRedirectUri,
  WHOP_OAUTH_COOKIES,
} from "@/lib/whop-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const clientId = process.env.WHOP_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json({ error: "Missing WHOP_CLIENT_ID" }, { status: 500 });
  }

  try {
    const redirectUri = getWhopRedirectUri(request);
    const { authorizationUrl, verifier, state } =
      await createWhopAuthorizationUrl(clientId, redirectUri);
    const response = NextResponse.redirect(authorizationUrl);
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/api/auth",
      maxAge: 10 * 60,
    };

    response.cookies.set(WHOP_OAUTH_COOKIES.verifier, verifier, cookieOptions);
    response.cookies.set(WHOP_OAUTH_COOKIES.state, state, cookieOptions);
    return response;
  } catch (error) {
    console.error("[WHOP OAUTH] Invalid application URL configuration:", error);
    return NextResponse.json(
      { error: "OAuth is not configured for this deployment" },
      { status: 500 },
    );
  }
}
