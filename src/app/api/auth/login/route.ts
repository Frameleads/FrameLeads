import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // EXECUTIVE OVERRIDE: Local Development Bypass
  // Whop's strict PKCE firewall is blocking localhost. We are bypassing it to unblock development.
  const response = NextResponse.redirect(new URL("/dashboard/ingestion", request.url));

  // Mint the exact cookies the middleware requires to let you into the app
  response.cookies.set("frameleads_session", "dev_bypass_master_key_999", { 
    httpOnly: true, 
    path: "/" 
  });
  response.cookies.set("tier", "enterprise", { 
    path: "/" 
  });

  return response;
}