import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveWhopSubscription } from "@/lib/whop-subscription";
import { mergeWhopUser } from "@/lib/whop-user";

type WhopUser = {
  id?: string;
  email?: string;
};

type WhopPayload = {
  type?: string;
  event?: string;
  action?: string;
  data?: {
    id?: string;
    email?: string;
    user_id?: string;
    user?: WhopUser;
    member?: { user?: WhopUser };
    product?: { id?: string; title?: string; route?: string; metadata?: unknown };
    plan?: { id?: string; title?: string; metadata?: unknown };
    membership?: {
      user?: WhopUser;
      product?: { id?: string; title?: string; route?: string; metadata?: unknown };
      plan?: { id?: string; title?: string; metadata?: unknown };
    };
  };
};

const ACTIVE_EVENTS = new Set([
  "membership.activated",
  "payment.succeeded",
  "membership_activated",
  "payment_succeeded",
  "membership_updated",
  "membership.went_valid",
]);

const INACTIVE_EVENTS = new Set([
  "membership.deactivated",
  "membership_cancelled",
  "membership.went_invalid",
]);

function getIdentity(payload: WhopPayload) {
  const user =
    payload.data?.user ||
    payload.data?.member?.user ||
    payload.data?.membership?.user;

  return {
    email: user?.email || payload.data?.email,
    whopUserId: user?.id || payload.data?.user_id,
  };
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as WhopPayload;
    const eventType = payload.type || payload.event || payload.action || "unknown";
    const { email, whopUserId } = getIdentity(payload);

    if (!email || !whopUserId) {
      console.warn(
        `[WHOP WEBHOOK] Ignored ${eventType}: missing user email or Whop user ID.`,
      );
      return NextResponse.json({ received: true, ignored: true });
    }

    if (ACTIVE_EVENTS.has(eventType)) {
      const subscription = resolveWhopSubscription(payload);
      await mergeWhopUser({ whopId: whopUserId, email, subscription });

      console.log(
        `[WHOP WEBHOOK] Synced ${email} as ${subscription.tier} from ${eventType}.`,
      );
      return NextResponse.json({ received: true, success: true });
    }

    if (INACTIVE_EVENTS.has(eventType)) {
      await prisma.user.updateMany({
        where: { OR: [{ whopId: whopUserId }, { email }] },
        data: { tier: "INACTIVE", monthlyQuota: 0 },
      });
      console.log(`[WHOP WEBHOOK] Downgraded ${email} from ${eventType}.`);
      return NextResponse.json({ received: true, success: true });
    }

    console.log(
      `[WHOP WEBHOOK] Unhandled event "${eventType}" - acknowledged without mutation.`,
    );
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[WHOP WEBHOOK] Error:", error);
    // A non-2xx response lets Whop retry transient database failures.
    return NextResponse.json(
      { received: false, error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
