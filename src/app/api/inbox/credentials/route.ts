import { ImapFlow } from "imapflow";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoreOrEnterpriseTier } from "@/lib/auth-guard";
import { encrypt } from "@/lib/encryption";
import { resolvePublicImapHost } from "@/lib/imap-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

async function getCurrentUser() {
  const cookieStore = await cookies();
  const email = cookieStore.get("user_email")?.value;
  return email
    ? prisma.user.findUnique({
        where: { email: normalizeEmail(email) },
        select: {
          id: true,
          imapEmail: true,
          imapHost: true,
          imapPort: true,
          imapPassword: true,
        },
      })
    : null;
}

export async function GET() {
  const authError = await requireCoreOrEnterpriseTier();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    mailbox: {
      connected: Boolean(user.imapEmail && user.imapHost && user.imapPort && user.imapPassword),
      email: user.imapEmail,
      host: user.imapHost,
      port: user.imapPort || 993,
    },
  });
}

export async function POST(request: Request) {
  let imapClient: ImapFlow | null = null;

  try {
    const authError = await requireCoreOrEnterpriseTier();
    if (authError) return authError;

    const requestOrigin = request.headers.get("origin");
    if (requestOrigin && requestOrigin !== new URL(request.url).origin) {
      return NextResponse.json({ success: false, error: "Invalid request origin." }, { status: 403 });
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const imapEmail = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    const requestedHost = typeof body?.host === "string" ? body.host : "";
    const imapPort = Number(body?.port);
    let appPassword = typeof body?.appPassword === "string" ? body.appPassword.trim() : "";

    if (!/^\S+@\S+\.\S+$/.test(imapEmail)) {
      return NextResponse.json({ success: false, error: "Enter a valid email address." }, { status: 400 });
    }
    if (!Number.isInteger(imapPort) || imapPort < 1 || imapPort > 65_535) {
      return NextResponse.json({ success: false, error: "Enter a valid IMAP port." }, { status: 400 });
    }

    const resolvedHost = await resolvePublicImapHost(requestedHost);
    if (resolvedHost.hostname === "imap.gmail.com") {
      appPassword = appPassword.replace(/\s+/g, "");
    }
    if (!appPassword) {
      return NextResponse.json({ success: false, error: "App Password is required." }, { status: 400 });
    }

    const configuredTestEmail = process.env.IMAP_TEST_EMAIL
      ? normalizeEmail(process.env.IMAP_TEST_EMAIL)
      : null;
    const shouldBypassConnectionTest = process.env.NODE_ENV === "development" && (
      process.env.IMAP_TEST_BYPASS === "true"
      || body?.bypassConnectionTest === true
      || configuredTestEmail === imapEmail
    );

    if (shouldBypassConnectionTest) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          imapEmail,
          imapHost: resolvedHost.hostname,
          imapPort,
          imapPassword: encrypt(appPassword),
        },
      });

      return NextResponse.json({
        success: true,
        simulated: true,
        mailbox: {
          connected: true,
          email: imapEmail,
          host: resolvedHost.hostname,
          port: imapPort,
        },
      });
    }

    imapClient = new ImapFlow({
      host: resolvedHost.address,
      port: imapPort,
      secure: imapPort === 993,
      tls: { servername: resolvedHost.hostname },
      auth: { user: imapEmail, pass: appPassword },
      logger: false,
      disableAutoIdle: true,
      verifyOnly: true,
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 60_000,
    });
    imapClient.on("error", () => undefined);
    await imapClient.connect();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        imapEmail,
        imapHost: resolvedHost.hostname,
        imapPort,
        imapPassword: encrypt(appPassword),
      },
    });

    return NextResponse.json({
      success: true,
      mailbox: {
        connected: true,
        email: imapEmail,
        host: resolvedHost.hostname,
        port: imapPort,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown IMAP error";
    console.error("[IMAP CREDENTIAL ERROR]:", message);

    if (message.includes("ENCRYPTION_KEY")) {
      return NextResponse.json(
        { success: false, error: "Mailbox encryption is not configured." },
        { status: 503 },
      );
    }
    if (message.includes("hostname") || message.includes("public addresses")) {
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }

    return NextResponse.json(
      { success: false, error: "Unable to authenticate with those IMAP credentials." },
      { status: 400 },
    );
  } finally {
    if (imapClient) {
      if (imapClient.usable) await imapClient.logout().catch(() => imapClient?.close());
      else imapClient.close();
    }
  }
}
