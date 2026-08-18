import { NextResponse } from "next/server";
import { getWhopRedirectUri } from "@/lib/whop-oauth";
import { mergeWhopUser } from "@/lib/whop-user";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) return NextResponse.redirect(new URL("/login?error=no_code", request.url));

  let redirectUri: string;
  try {
    redirectUri = getWhopRedirectUri(request);
  } catch (error) {
    console.error("[WHOP OAUTH] Invalid application URL configuration:", error);
    return NextResponse.redirect(
      new URL("/login?error=oauth_configuration", request.url),
    );
  }

  // 1. Token Exchange
  const tokenRes = await fetch("https://api.whop.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: code,
      client_id: process.env.WHOP_CLIENT_ID,
      client_secret: process.env.WHOP_CLIENT_SECRET,
      redirect_uri: redirectUri,
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
  const whopId = profileData.id || profileData.data?.id;
  const email = profileData.email || profileData.data?.email;

  if (!whopId || !email) {
    return NextResponse.redirect(new URL("/login?error=invalid_profile", request.url));
  }

  // 3. Merge with any user created concurrently by a checkout webhook.
  // Omitting subscription here preserves the paid tier written by the webhook.
  let user: Awaited<ReturnType<typeof mergeWhopUser>>;
  try {
    user = await mergeWhopUser({ whopId, email });
  } catch (error) {
    console.error("[WHOP OAUTH] Failed to merge user:", error);
    return NextResponse.redirect(
      new URL("/login?error=user_sync_failed", request.url),
    );
  }

  // ADMIN OVERRIDE INJECTION
  const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  const isSystemAdmin = user?.email && user.email === ADMIN_EMAIL;
  const effectiveTier = isSystemAdmin ? 'ENTERPRISE' : user?.tier;

  // 4. Mint Session with Dynamic Tier -> REDIRECTS TO WELCOME PORTAL
  const response = NextResponse.redirect(new URL("/welcome", request.url));
  response.cookies.set("frameleads_session", accessToken, { httpOnly: true, path: "/" });
  response.cookies.set("tier", effectiveTier, { path: "/" }); 
  response.cookies.set("user_email", email, { httpOnly: true, path: "/" });
  
  return response;
}
