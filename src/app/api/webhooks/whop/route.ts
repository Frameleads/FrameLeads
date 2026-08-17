import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

type Subscription = {
  tier: "FREE" | "MICRO_PILOT" | "CORE" | "ENTERPRISE";
  monthlyQuota: number;
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

// Current public Whop products and plans. The environment variables allow
// these mappings to be extended/replaced without another deployment.
const DEFAULT_TIER_IDS = {
  MICRO_PILOT: ["prod_bTf6npFBh6teM", "plan_8qLWfJZHQUYZf"],
  CORE: ["prod_1GtBYI46Z2HQS", "plan_MUeh0CYdRPPaJ"],
  ENTERPRISE: ["prod_7CoRolH7SDjmQ", "plan_PZqjKqvMr0KBI"],
} as const;

function configuredIds(name: string, defaults: readonly string[]) {
  const values = process.env[name]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set(values?.length ? values : defaults);
}

function getSubscription(payload: WhopPayload): Subscription {
  const product = payload.data?.product || payload.data?.membership?.product;
  const plan = payload.data?.plan || payload.data?.membership?.plan;
  const ids = new Set([product?.id, plan?.id].filter(Boolean));

  const mappings: Array<{
    tier: Subscription["tier"];
    monthlyQuota: number;
    ids: Set<string>;
  }> = [
    {
      tier: "ENTERPRISE",
      monthlyQuota: 20_000,
      ids: configuredIds("WHOP_ENTERPRISE_IDS", DEFAULT_TIER_IDS.ENTERPRISE),
    },
    {
      tier: "CORE",
      monthlyQuota: 500,
      ids: configuredIds("WHOP_CORE_IDS", DEFAULT_TIER_IDS.CORE),
    },
    {
      tier: "MICRO_PILOT",
      monthlyQuota: 25,
      ids: configuredIds("WHOP_MICRO_IDS", DEFAULT_TIER_IDS.MICRO_PILOT),
    },
  ];

  for (const mapping of mappings) {
    if ([...ids].some((id) => mapping.ids.has(id as string))) {
      return { tier: mapping.tier, monthlyQuota: mapping.monthlyQuota };
    }
  }

  // Keep a title/metadata fallback for legacy payloads that omit IDs.
  const payloadString = JSON.stringify(payload).toLowerCase();
  if (/\benterprise\b/.test(payloadString)) {
    return { tier: "ENTERPRISE", monthlyQuota: 20_000 };
  }
  if (/\bcore\b/.test(payloadString)) {
    return { tier: "CORE", monthlyQuota: 500 };
  }
  if (/\bmicro(?:-pilot)?\b/.test(payloadString)) {
    return { tier: "MICRO_PILOT", monthlyQuota: 25 };
  }

  return { tier: "FREE", monthlyQuota: 0 };
}

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
      const subscription = getSubscription(payload);
      const existingUser = await prisma.user.findFirst({
        where: { OR: [{ whopId: whopUserId }, { email }] },
        select: { id: true },
      });

      if (existingUser) {
        await prisma.user.update({
          where: { id: existingUser.id },
          data: { whopId: whopUserId, email, ...subscription },
        });
      } else {
        await prisma.user.create({
          data: {
            whopId: whopUserId,
            email,
            ...subscription,
            leadsProcessed: 0,
          },
        });
      }

      console.log(
        `[WHOP WEBHOOK] Synced ${email} as ${subscription.tier} from ${eventType}.`,
      );
      return NextResponse.json({ received: true, success: true });
    }

    if (INACTIVE_EVENTS.has(eventType)) {
      await prisma.user.updateMany({
        where: { OR: [{ whopId: whopUserId }, { email }] },
        data: { tier: "FREE", monthlyQuota: 0 },
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
