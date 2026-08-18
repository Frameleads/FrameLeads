import { NextRequest, NextResponse } from "next/server";
import { getWhopRedirectUri, WHOP_OAUTH_COOKIES } from "@/lib/whop-oauth";
import { verifyWhopSubscription } from "@/lib/whop-memberships";
import { NoActivePaidSubscriptionError } from "@/lib/whop-subscription";
import { mergeWhopUser } from "@/lib/whop-user";

export const dynamic = "force-dynamic";

function clearOAuthCookies(response: NextResponse) {
  response.cookies.delete(WHOP_OAUTH_COOKIES.verifier);
  response.cookies.delete(WHOP_OAUTH_COOKIES.state);
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const oauthErrorDescription = searchParams.get("error_description");

  if (oauthError) {
    console.error("[WHOP OAUTH] Authorization rejected:", {
      error: oauthError,
      description: oauthErrorDescription,
    });
    return clearOAuthCookies(
      NextResponse.redirect(new URL("/login?error=authorization_rejected", request.url)),
    );
  }

  if (!code) {
    return clearOAuthCookies(
      NextResponse.redirect(new URL("/login?error=no_code", request.url)),
    );
  }

  const expectedState = request.cookies.get(WHOP_OAUTH_COOKIES.state)?.value;
  const codeVerifier = request.cookies.get(WHOP_OAUTH_COOKIES.verifier)?.value;

  if (!expectedState || !codeVerifier || returnedState !== expectedState) {
    console.error("[WHOP OAUTH] State or PKCE cookie validation failed.", {
      hasExpectedState: Boolean(expectedState),
      hasReturnedState: Boolean(returnedState),
      hasCodeVerifier: Boolean(codeVerifier),
      stateMatches: Boolean(expectedState && returnedState === expectedState),
    });
    return clearOAuthCookies(
      NextResponse.redirect(new URL("/login?error=invalid_oauth_state", request.url)),
    );
  }

  let redirectUri: string;
  try {
    redirectUri = getWhopRedirectUri(request);
  } catch (error) {
    console.error("[WHOP OAUTH] Invalid application URL configuration:", error);
    return NextResponse.redirect(
      new URL("/login?error=oauth_configuration", request.url),
    );
  }

  const clientId = process.env.WHOP_CLIENT_ID;
  const clientSecret = process.env.WHOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[WHOP OAUTH] Missing OAuth client credentials during callback.", {
      hasClientId: Boolean(clientId),
      hasClientSecret: Boolean(clientSecret),
    });
    return clearOAuthCookies(
      NextResponse.redirect(new URL("/login?error=oauth_configuration", request.url)),
    );
  }

  // 1. Exchange the single-use code using Whop's OAuth 2.1 PKCE contract.
  let data: { access_token?: string };
  try {
    const tokenRes = await fetch("https://api.whop.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
      cache: "no-store",
    });
    const rawResponse = await tokenRes.text();

    if (!tokenRes.ok) {
      console.error("[WHOP OAUTH] Token exchange rejected by Whop:", {
        status: tokenRes.status,
        statusText: tokenRes.statusText,
        rawResponse,
        redirectUri,
        hasBasicAuthentication: true,
        hasCodeVerifier: Boolean(codeVerifier),
      });
      return clearOAuthCookies(
        NextResponse.redirect(
          new URL("/login?error=token_exchange_failed", request.url),
        ),
      );
    }

    try {
      data = JSON.parse(rawResponse) as { access_token?: string };
    } catch (error) {
      console.error("[WHOP OAUTH] Whop returned non-JSON token data:", {
        rawResponse,
        error,
      });
      return clearOAuthCookies(
        NextResponse.redirect(
          new URL("/login?error=invalid_token_response", request.url),
        ),
      );
    }
  } catch (error) {
    console.error("[WHOP OAUTH] Token exchange request failed:", error);
    return clearOAuthCookies(
      NextResponse.redirect(
        new URL("/login?error=token_exchange_unavailable", request.url),
      ),
    );
  }

  const accessToken = data.access_token;

  if (!accessToken) {
    console.error("[WHOP OAUTH] Successful token response omitted access_token.");
    return clearOAuthCookies(
      NextResponse.redirect(new URL("/login?error=no_token", request.url)),
    );
  }

  // 2. Fetch User Profile
  const profileRes = await fetch("https://api.whop.com/oauth/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!profileRes.ok) {
    const rawResponse = await profileRes.text();
    console.error("[WHOP OAUTH] Userinfo request failed:", {
      status: profileRes.status,
      rawResponse,
    });
    return clearOAuthCookies(
      NextResponse.redirect(new URL("/login?error=profile_fetch_failed", request.url)),
    );
  }

  const profileData = await profileRes.json();
  const whopId = profileData.sub || profileData.id || profileData.data?.id;
  const email = profileData.email || profileData.data?.email;

  if (!whopId || !email) {
    return clearOAuthCookies(
      NextResponse.redirect(new URL("/login?error=invalid_profile", request.url)),
    );
  }

  // 3. Verify paid access synchronously so login does not depend on webhook
  // delivery timing. A failed API check never creates an unauthorized user.
  let subscription: Awaited<ReturnType<typeof verifyWhopSubscription>>;
  try {
    subscription = await verifyWhopSubscription(accessToken, whopId);
  } catch (error) {
    console.error("[WHOP OAUTH] Unable to verify membership during login:", error);
    if (error instanceof NoActivePaidSubscriptionError) {
      return clearOAuthCookies(
        NextResponse.redirect(
          new URL("/login?error=no_active_subscription", request.url),
        ),
      );
    }

    return clearOAuthCookies(
      NextResponse.redirect(
        new URL("/login?error=membership_verification_failed", request.url),
      ),
    );
  }

  // 4. Merge with any user created concurrently by a checkout webhook.
  let user: Awaited<ReturnType<typeof mergeWhopUser>>;
  try {
    user = await mergeWhopUser({ whopId, email, subscription });
  } catch (error) {
    console.error("[WHOP OAUTH] Failed to merge user:", error);
    return clearOAuthCookies(
      NextResponse.redirect(new URL("/login?error=user_sync_failed", request.url)),
    );
  }

  // ADMIN OVERRIDE INJECTION
  const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  const isSystemAdmin = user?.email && user.email === ADMIN_EMAIL;
  const effectiveTier = isSystemAdmin ? 'ENTERPRISE' : user?.tier;

  // 5. Mint Session with Dynamic Tier -> REDIRECTS TO WELCOME PORTAL
  const response = NextResponse.redirect(new URL("/welcome", request.url));
  response.cookies.set("frameleads_session", accessToken, { httpOnly: true, path: "/" });
  response.cookies.set("tier", effectiveTier, { path: "/" }); 
  response.cookies.set("user_email", email, { httpOnly: true, path: "/" });
  
  return clearOAuthCookies(response);
}
