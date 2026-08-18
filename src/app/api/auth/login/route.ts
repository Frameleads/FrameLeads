import { NextResponse } from "next/server";
import { getWhopRedirectUri } from "@/lib/whop-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const clientId = process.env.WHOP_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json({ error: "Missing WHOP_CLIENT_ID" }, { status: 500 });
  }

  try {
    const redirectUri = getWhopRedirectUri(request);
    const whopOAuthUrl = new URL("https://whop.com/oauth");
    whopOAuthUrl.searchParams.set("client_id", clientId);
    whopOAuthUrl.searchParams.set("redirect_uri", redirectUri);

    return NextResponse.redirect(whopOAuthUrl);
  } catch (error) {
    console.error("[WHOP OAUTH] Invalid application URL configuration:", error);
    return NextResponse.json(
      { error: "OAuth is not configured for this deployment" },
      { status: 500 },
    );
  }
}
