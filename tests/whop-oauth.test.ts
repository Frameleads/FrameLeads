import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createWhopAuthorizationUrl, getWhopRedirectUri, WHOP_OAUTH_COOKIES } from "../src/lib/whop-oauth";

const previousNodeEnv = process.env.NODE_ENV;
const previousRedirectUri = process.env.WHOP_REDIRECT_URI;
const env = process.env as Record<string, string | undefined>;

function setEnvironment(nodeEnv: string, redirectUri?: string) {
  env.NODE_ENV = nodeEnv;
  if (redirectUri === undefined) delete env.WHOP_REDIRECT_URI;
  else env.WHOP_REDIRECT_URI = redirectUri;
}

async function main() {
  const request = new Request("https://request-host.invalid/api/auth/login");

  setEnvironment("production", "https://app.frameleads.io/api/auth/callback");
  assert.equal(
    getWhopRedirectUri(request),
    "https://app.frameleads.io/api/auth/callback",
    "production must use the explicit canonical callback",
  );
  setEnvironment("production");
  assert.throws(() => getWhopRedirectUri(request), { message: /Missing WHOP_REDIRECT_URI/ });

  setEnvironment("production", "https://app.frameleads.io/other");
  assert.throws(() => getWhopRedirectUri(request), { message: /exactly in \/api\/auth\/callback/ });
  setEnvironment("production", "http://localhost:3000/api/auth/callback");
  assert.throws(() => getWhopRedirectUri(request), { message: /must use HTTPS in production/ });
  setEnvironment("production", "https://user:pass@app.frameleads.io/api/auth/callback");
  assert.throws(() => getWhopRedirectUri(request), { message: /without credentials/ });
  setEnvironment("production", "https://app.frameleads.io/api/auth/callback?code=bad");
  assert.throws(() => getWhopRedirectUri(request), { message: /without credentials/ });

  setEnvironment("development", "http://localhost:3000/api/auth/callback");
  assert.equal(getWhopRedirectUri(request), "http://localhost:3000/api/auth/callback");
  setEnvironment("development");
  assert.equal(
    getWhopRedirectUri(new Request("http://localhost:3000/api/auth/login")),
    "http://localhost:3000/api/auth/callback",
  );

  setEnvironment("production", "https://app.frameleads.io/api/auth/callback");
  const { authorizationUrl, verifier, state } = await createWhopAuthorizationUrl(
    "test-client",
    getWhopRedirectUri(request),
  );
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), "https://app.frameleads.io/api/auth/callback");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizationUrl.searchParams.get("code_challenge"));
  assert.ok(verifier);
  assert.ok(state);

  const callbackSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/auth/callback/route.ts"),
    "utf8",
  );
  assert.match(callbackSource, /redirectUri\s*=\s*getWhopRedirectUri\(request\)/);
  assert.match(callbackSource, /redirect_uri:\s*redirectUri/);
  assert.match(callbackSource, /returnedState\s*!==\s*expectedState/);
  assert.match(callbackSource, /code_verifier:\s*codeVerifier/);
  assert.match(callbackSource, /new URL\("\/welcome", request\.url\)/);
  assert.match(callbackSource, /WHOP_OAUTH_COOKIES\.state/);
  assert.match(callbackSource, /WHOP_OAUTH_COOKIES\.verifier/);
  assert.equal(WHOP_OAUTH_COOKIES.state, "whop_oauth_state");
  assert.equal(WHOP_OAUTH_COOKIES.verifier, "whop_oauth_verifier");

  console.log("PASS: Whop OAuth canonical callback configuration, authorize URI, token exchange, state, PKCE, and welcome redirect.");
}

main().finally(() => {
  if (previousNodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = previousNodeEnv;
  if (previousRedirectUri === undefined) delete env.WHOP_REDIRECT_URI;
  else env.WHOP_REDIRECT_URI = previousRedirectUri;
});
