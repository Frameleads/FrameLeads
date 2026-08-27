import nodemailer from "nodemailer";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { decrypt } from "@/lib/encryption";
import { resolvePublicImapHost } from "@/lib/imap-security";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function resolveSmtpSettings(imapHost: string): SmtpSettings | null {
  const host = imapHost.trim().toLowerCase();

  if (host.includes("gmail")) {
    return { host: "smtp.gmail.com", port: 465, secure: true };
  }
  if (host.includes("outlook") || host.includes("office365") || host.includes("hotmail")) {
    return { host: "smtp.office365.com", port: 587, secure: false };
  }
  if (host.includes("yahoo")) {
    return { host: "smtp.mail.yahoo.com", port: 465, secure: true };
  }
  if (host.startsWith("imap.")) {
    return { host: `smtp.${host.slice("imap.".length)}`, port: 465, secure: true };
  }

  return null;
}

function htmlToPlainText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

export async function POST(request: Request) {
  let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

  try {
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin && requestOrigin !== new URL(request.url).origin) {
      return NextResponse.json({ success: false, error: "Invalid request origin." }, { status: 403 });
    }

    const cookieStore = await cookies();
    const userEmail = cookieStore.get("user_email")?.value;
    if (!userEmail) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(userEmail) },
      select: {
        id: true,
        imapEmail: true,
        imapPassword: true,
        imapHost: true,
      },
    });
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }
    if (!user.imapEmail || !user.imapPassword || !user.imapHost) {
      return NextResponse.json(
        { success: false, error: "Connect your native inbox before sending email." },
        { status: 409 },
      );
    }

    const payload = await request.json().catch(() => null);
    const to = typeof payload?.to === "string" ? normalizeEmail(payload.to) : "";
    const subject = typeof payload?.subject === "string" ? payload.subject.trim() : "";
    const htmlBody = typeof payload?.htmlBody === "string" ? payload.htmlBody.trim() : "";

    if (!/^\S+@\S+\.\S+$/.test(to)) {
      return NextResponse.json({ success: false, error: "This lead does not have a valid email address." }, { status: 400 });
    }
    if (!subject || subject.length > 500) {
      return NextResponse.json({ success: false, error: "Enter a valid email subject." }, { status: 400 });
    }
    if (!htmlBody || htmlBody.length > 200_000) {
      return NextResponse.json({ success: false, error: "Enter a valid email body." }, { status: 400 });
    }

    const ownedLead = await prisma.generatedLead.findFirst({
      where: {
        userId: user.id,
        email: { equals: to, mode: "insensitive" },
      },
      select: { id: true, email: true },
    });
    if (!ownedLead?.email) {
      return NextResponse.json(
        { success: false, error: "Recipient is not a lead in your Sandbox." },
        { status: 403 },
      );
    }

    const smtpSettings = resolveSmtpSettings(user.imapHost);
    if (!smtpSettings) {
      return NextResponse.json(
        { success: false, error: "This mailbox host does not have a supported SMTP mapping." },
        { status: 400 },
      );
    }

    const resolvedHost = await resolvePublicImapHost(smtpSettings.host);
    const password = decrypt(user.imapPassword);
    transporter = nodemailer.createTransport({
      host: resolvedHost.address,
      port: smtpSettings.port,
      secure: smtpSettings.secure,
      auth: { user: user.imapEmail, pass: password },
      tls: { servername: resolvedHost.hostname },
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });

    await transporter.sendMail({
      from: user.imapEmail,
      to: ownedLead.email,
      subject,
      html: htmlBody,
      text: htmlToPlainText(htmlBody),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown SMTP error";
    console.error("[NATIVE EMAIL SEND ERROR]:", message);

    if (message.includes("ENCRYPTION_KEY") || message.includes("Stored IMAP password")) {
      return NextResponse.json(
        { success: false, error: "Mailbox encryption is not configured correctly." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { success: false, error: "Unable to send email through the connected inbox." },
      { status: 502 },
    );
  } finally {
    transporter?.close();
  }
}
