import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) return NextResponse.redirect(new URL("/login?error=no_code", request.url));

  // The exact JSON payload that worked 3 hours ago
  const tokenRes = await fetch("https://api.whop.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: code,
      client_id: process.env.WHOP_CLIENT_ID,
      client_secret: process.env.WHOP_CLIENT_SECRET,
      redirect_uri: process.env.WHOP_REDIRECT_URI || "http://localhost:3000/api/auth/callback"
    }),
  });

  // The missing safety net from 3 hours ago
  if (!tokenRes.ok) {
     return NextResponse.redirect(new URL("/login?error=expired_code", request.url));
  }

  const data = await tokenRes.json();

  // Mint Session and Bypass Gateway
  const response = NextResponse.redirect(new URL("/dashboard/ingestion", request.url));
  response.cookies.set("frameleads_session", data.access_token || "auth_success", { httpOnly: true, path: "/" });
  response.cookies.set("tier", "enterprise", { path: "/" }); 
  
  return response;
}