import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { htmlToPlainText, sendNativeEmail, NativeMailUnavailable } from '@/lib/outbound/native-mail';
import { getUserEntitlementTier, requireFeatureAccess } from '@/lib/auth-guard';
import { verifiedCustomerUser } from '@/lib/customer-session';
import { MicroPilotSandboxSendError, sendMicroPilotSandboxEmail } from '@/lib/outbound/micro-pilot-sandbox-send';

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function POST(request: Request) {
  try {
    const entitlementError = await requireFeatureAccess('BASE_OUTBOUND');
    if (entitlementError) return entitlementError;
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin && requestOrigin !== new URL(request.url).origin) {
      return NextResponse.json({ success: false, error: "Invalid request origin." }, { status: 403 });
    }

    const principal = await verifiedCustomerUser();
    const user = principal ? await prisma.user.findUnique({
      where: { id: principal.id },
      select: {
        id: true,
        tier: true,
        imapEmail: true,
        imapPassword: true,
        imapHost: true,
      },
    }) : null;
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }
    const tier = await getUserEntitlementTier(user.id);
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

    if (tier === 'MICRO_PILOT') {
      if (requestOrigin !== new URL(request.url).origin) return NextResponse.json({ success: false, error: 'Invalid request origin.' }, { status: 403 });
      if (typeof payload?.leadId !== 'string' || payload.leadId.length > 128 || payload.confirmSend !== true)
        return NextResponse.json({ success: false, error: 'Select an eligible Sandbox prospect and confirm the send.' }, { status: 400 });
      const result = await sendMicroPilotSandboxEmail({ userId: user.id, leadId: payload.leadId, to, subject, html: htmlBody,
        text: htmlToPlainText(htmlBody), confirmed: true });
      return NextResponse.json(result);
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
    if (error instanceof MicroPilotSandboxSendError) {
      const status = error.reason === 'ALREADY_SENT' ? 409 : error.reason === 'DAILY_LIMIT_REACHED' ? 429 : 403;
      const errorMessage = error.reason === 'SENDER_DOMAIN_NOT_CONFIGURED'
        ? 'Outbound sending is locked until you configure your workspace root brand domain and connect an eligible secondary sending domain.'
        : error.reason === 'SENDER_DOMAIN_BLOCKED'
          ? 'Domain Armor blocked this sender. Connect a secondary sending domain that differs from your root brand domain.'
          : error.reason;
      return NextResponse.json({ success: false, error: errorMessage, code: error.reason }, { status });
    }
    if (error instanceof TypeError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
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
