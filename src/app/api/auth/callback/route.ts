import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) return NextResponse.redirect(new URL("/login?error=no_code", request.url));

  // 1. Token Exchange
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

  if (!tokenRes.ok) {
     return NextResponse.redirect(new URL("/login?error=expired_code", request.url));
  }

  const data = await tokenRes.json();
  const accessToken = data.access_token;

  if (!accessToken) {
    return NextResponse.redirect(new URL("/login?error=no_token", request.url));
  }

  // 2. Fetch User Profile
  const profileRes = await fetch("https://api.whop.com/v2/me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!profileRes.ok) {
    return NextResponse.redirect(new URL("/login?error=profile_fetch_failed", request.url));
  }

  const profileData = await profileRes.json();
  const whopId = profileData.id || profileData.data?.id || "unknown";
  const email = profileData.email || profileData.data?.email || "unknown@example.com";

  // 3. Prisma Upsert
  const user = await prisma.user.upsert({
    where: { whopId: whopId },
    update: { email: email },
    create: {
      whopId: whopId,
      email: email,
      tier: "CORE"
    }
  });

  // 4. Mint Session with Dynamic Tier
  const response = NextResponse.redirect(new URL("/dashboard/ingestion", request.url));
  response.cookies.set("frameleads_session", accessToken, { httpOnly: true, path: "/" });
  response.cookies.set("tier", user.tier, { path: "/" }); 
  
  return response;
}