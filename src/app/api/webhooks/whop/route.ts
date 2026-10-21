import { unwrapWebhook, WebhookVerificationError } from '@whop/sdk/helpers';
import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { applyVerifiedWhopEvent, type VerifiedWhopPayload } from '@/lib/whop-webhook-processing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WhopPayload = VerifiedWhopPayload & {
  type?: string;
  event?: string;
  action?: string;
  data?: {
    id?: string;
    membership?: {
      user?: { id?: string; email?: string };
      product?: { id?: string; title?: string; name?: string };
      plan?: { id?: string; title?: string; name?: string };
    };
    user?: { id?: string; email?: string };
    member?: { user?: { id?: string; email?: string } };
    user_id?: string;
    email?: string;
    product?: { id?: string; title?: string; name?: string };
    plan?: { id?: string; title?: string; name?: string };
  };
};

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function POST(request: Request) {
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[WHOP WEBHOOK] Verification secret is not configured.');
    return NextResponse.json({ received: false, error: 'Webhook verification unavailable.' }, { status: 503 });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 1_000_000) {
    return NextResponse.json({ received: false, error: 'Webhook body too large.' }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > 1_000_000) {
    return NextResponse.json({ received: false, error: 'Webhook body too large.' }, { status: 413 });
  }

  let payload: WhopPayload;
  try {
    // Whop's helper verifies the untouched body, Standard Webhooks HMAC, and
    // the ±5 minute timestamp window before returning any parsed event.
    payload = unwrapWebhook<WhopPayload>(rawBody, {
      headers: Object.fromEntries(request.headers),
      key: secret,
    });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return NextResponse.json({ received: false, error: 'Invalid or expired webhook signature.' }, { status: 401 });
    }
    console.error('[WHOP WEBHOOK] Verification failed.');
    return NextResponse.json({ received: false, error: 'Webhook verification unavailable.' }, { status: 503 });
  }

  const webhookId = request.headers.get('webhook-id');
  const eventType = payload.type || payload.event || payload.action;
  if (!webhookId || !eventType) {
    return NextResponse.json({ received: false, error: 'Invalid webhook envelope.' }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await applyVerifiedWhopEvent(tx, webhookId, eventType, payload);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const previousDelivery = await prisma.whopWebhookReceipt.findUnique({
        where: { webhookId }, select: { webhookId: true },
      });
      if (previousDelivery) return NextResponse.json({ received: true, duplicate: true });
    }
    // A non-2xx response lets Whop retry transient database failures.
    console.error('[WHOP WEBHOOK] Verified event processing failed.', { eventType, webhookId });
    return NextResponse.json({ received: false, error: 'Webhook processing failed.' }, { status: 500 });
  }

  return NextResponse.json({ received: true, success: true });
}
