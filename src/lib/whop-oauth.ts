const WHOP_CALLBACK_PATH = "/api/auth/callback";

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
