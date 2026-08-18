const WHOP_CALLBACK_PATH = "/api/auth/callback";

export const WHOP_OAUTH_COOKIES = {
  state: "whop_oauth_state",
  verifier: "whop_oauth_verifier",
} as const;

function base64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

function randomString(length: number) {
  return base64Url(crypto.getRandomValues(new Uint8Array(length)));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

function configuredAppOrigin() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configuredUrl) return null;

  const url = new URL(configuredUrl);
  const hasUnexpectedParts =
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "");

  if (hasUnexpectedParts) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL must contain only the application origin (for example, https://frame-leads.vercel.app).",
    );
  }

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS in production.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use HTTP or HTTPS.");
  }

  return url.origin;
}

/**
 * Returns the one canonical redirect URI used for both OAuth authorization
 * and the subsequent token exchange. Production requires an explicit stable
 * origin; development derives it from the incoming request.
 */
export function getWhopRedirectUri(request: Request) {
  const appOrigin = configuredAppOrigin();

  if (!appOrigin && process.env.NODE_ENV === "production") {
    throw new Error("Missing NEXT_PUBLIC_APP_URL in the production environment.");
  }

  const requestOrigin = new URL(request.url).origin;
  return new URL(WHOP_CALLBACK_PATH, appOrigin || requestOrigin).toString();
}

export async function createWhopAuthorizationUrl(
  clientId: string,
  redirectUri: string,
) {
  const verifier = randomString(32);
  const state = randomString(24);
  const nonce = randomString(24);
  const authorizationUrl = new URL("https://api.whop.com/oauth/authorize");

  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set(
    "scope",
    "openid profile email member:basic:read member:email:read",
  );
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", await sha256(verifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  return { authorizationUrl, verifier, state };
}
