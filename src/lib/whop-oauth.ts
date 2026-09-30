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

function configuredWhopRedirectUri() {
  const configuredUrl = process.env.WHOP_REDIRECT_URI?.trim();
  if (!configuredUrl) return null;

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("WHOP_REDIRECT_URI must be a valid absolute URL.");
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== WHOP_CALLBACK_PATH
  ) {
    throw new Error(
      "WHOP_REDIRECT_URI must be an absolute callback URL ending exactly in /api/auth/callback, without credentials, query, or hash (for example, https://app.frameleads.io/api/auth/callback).",
    );
  }

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("WHOP_REDIRECT_URI must use HTTPS in production.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("WHOP_REDIRECT_URI must use HTTP or HTTPS.");
  }

  return url.toString();
}

/**
 * Returns the one callback URI used for both OAuth authorization and token
 * exchange. Production requires an explicit callback; development can fall
 * back to the incoming request origin for local use.
 */
export function getWhopRedirectUri(request: Request) {
  const configuredUri = configuredWhopRedirectUri();

  if (!configuredUri && process.env.NODE_ENV === "production") {
    throw new Error("Missing WHOP_REDIRECT_URI in the production environment.");
  }

  const requestOrigin = new URL(request.url).origin;
  return configuredUri || new URL(WHOP_CALLBACK_PATH, requestOrigin).toString();
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
