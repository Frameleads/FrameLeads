import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ── Tier mapping constants ────────────────────────────────────────────────────
const TIER_CONFIG = {
  MICRO_PILOT: { tier: 'MICRO_PILOT' as const, monthlyQuota: 25    },
  CORE:       { tier: 'CORE'       as const, monthlyQuota: 500   },
  ENTERPRISE: { tier: 'ENTERPRISE' as const, monthlyQuota: 20000 },
  FREE:       { tier: 'FREE'       as const, monthlyQuota: 0     },
};

// Derive tier from the plan/product name Whop sends in the payload.
// We check for 'Enterprise' first so plans like "Enterprise Core" don't
// accidentally resolve to CORE.
function resolveTierFromPlanName(planName: string | undefined | null): keyof typeof TIER_CONFIG {
  if (!planName) return 'FREE';
  const name = planName.toLowerCase();
  if (name.includes('enterprise')) return 'ENTERPRISE';
  if (name.includes('core'))       return 'CORE';
  if (name.includes('micro-pilot') || name.includes('micro pilot')) return 'MICRO_PILOT';
  return 'FREE';
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const action: string = payload?.action ?? 'unknown';

    console.log('[WHOP WEBHOOK] Signal Received:', action);
    console.log('[WHOP WEBHOOK] Raw payload:', JSON.stringify(payload, null, 2));

    // ── Defensively extract nested fields ──────────────────────────────────
    const data       = payload?.data ?? payload;
    const email: string | undefined      = data?.user?.email ?? data?.email;
    const whopId: string | undefined     = data?.user?.id    ?? data?.whop_id ?? data?.id;

    // The plan name can live in several places depending on Whop's event type
    const planName: string | undefined =
      data?.plan?.name ??
      data?.product?.name ??
      data?.membership?.plan?.name ??
      data?.plan_name;

    if (!email && !whopId) {
      console.warn('[WHOP WEBHOOK] Ignored: Malformed payload — no user identifiers found.');
      return NextResponse.json({ received: true, ignored: true });
    }

    // ── Route by action ────────────────────────────────────────────────────
    if (action === 'membership.went_valid') {
      // Subscription activated or payment succeeded
      const tierKey    = resolveTierFromPlanName(planName);
      const tierConfig = TIER_CONFIG[tierKey];

      const where = email ? { email } : { whopId };
      await prisma.user.updateMany({
        where,
        data: {
          tier:         tierConfig.tier,
          monthlyQuota: tierConfig.monthlyQuota,
        },
      });

      console.log(
        `[WHOP WEBHOOK] Upgraded to ${tierConfig.tier} (quota: ${tierConfig.monthlyQuota})` +
        ` for ${email ?? whopId} (plan: "${planName ?? 'unknown'}")`
      );

    } else if (action === 'membership.went_invalid') {
      // Subscription cancelled or payment failed — lock the account down
      const where = email ? { email } : { whopId };
      await prisma.user.updateMany({
        where,
        data: {
          tier:         TIER_CONFIG.FREE.tier,
          monthlyQuota: TIER_CONFIG.FREE.monthlyQuota,
        },
      });

      console.log(
        `[WHOP WEBHOOK] Account locked to FREE for ${email ?? whopId}` +
        ` (reason: ${action})`
      );

    } else {
      // Unhandled event type — log and acknowledge so Whop doesn't retry
      console.log(`[WHOP WEBHOOK] Unhandled action "${action}" — acknowledging without mutation.`);
    }

    return NextResponse.json({ received: true });

  } catch (error) {
    console.error('[WHOP WEBHOOK] Catastrophic failure during processing:', error);
    // Always return 200 so Whop doesn't queue retries for a transient crash
    return NextResponse.json({ received: true, error: 'internal_error' }, { status: 200 });
  }
}

