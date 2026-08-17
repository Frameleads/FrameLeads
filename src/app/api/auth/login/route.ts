import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const clientId = process.env.WHOP_CLIENT_ID;
  const redirectUri = process.env.WHOP_REDIRECT_URI || "http://localhost:3000/api/auth/callback";

  if (!clientId) {
    return NextResponse.json({ error: "Missing WHOP_CLIENT_ID" }, { status: 500 });
  }

  const whopOAuthUrl = `https://whop.com/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  return NextResponse.redirect(whopOAuthUrl);
}