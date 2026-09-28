import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { htmlToPlainText, sendNativeEmail, NativeMailUnavailable } from '@/lib/outbound/native-mail';

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function POST(request: Request) {
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

    if (process.env.NODE_ENV === 'development' && process.env.IMAP_TEST_BYPASS === 'true') {
      return NextResponse.json({
        success: true,
        message: 'Mock email sent successfully (Dev Bypass Active)',
      });
    }

    await sendNativeEmail({ userId: user.id, leadId: ownedLead.id, to: ownedLead.email,
      subject, html: htmlBody, text: htmlToPlainText(htmlBody) });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown SMTP error";
    if (error instanceof NativeMailUnavailable) return NextResponse.json({ success: false, error: message }, { status: 409 });
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
  }
}
