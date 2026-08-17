import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ── Tier mapping constants ────────────────────────────────────────────────────
const TIER_CONFIG = {
  MICRO_PILOT: { tier: 'MICRO_PILOT' as const, monthlyQuota: 25    },
  CORE:        { tier: 'CORE'        as const, monthlyQuota: 500   },
  ENTERPRISE:  { tier: 'ENTERPRISE'  as const, monthlyQuota: 20000 },
  FREE:        { tier: 'FREE'        as const, monthlyQuota: 0     },
};

// The tier is determined globally via a sledgehammer JSON string match below.

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    console.log('WEBHOOK PAYLOAD RECEIVED:', payload);

    // ── Extract event type — Whop sends this under different keys ──────────
    const eventType: string = payload?.event || payload?.type || payload?.action || 'unknown';
    console.log('[WHOP WEBHOOK] Event type resolved to:', eventType);

    // ── Extract user identifiers ───────────────────────────────────────────
    const email: string | undefined   = payload?.data?.user?.email ?? payload?.data?.email;
    const whopUserId: string | undefined = payload?.data?.user?.id ?? payload?.data?.id;

    // ── Extract product/plan name from all known Whop paths ───────────────
    const planName: string =
      payload?.data?.product?.name    ||
      payload?.data?.plan?.name       ||
      payload?.data?.experience?.name ||
      payload?.data?.membership?.plan?.name ||
      '';

    console.log(`[WHOP WEBHOOK] email=${email} | whopId=${whopUserId} | plan="${planName}"`);

    if (!email && !whopUserId) {
      console.warn('[WHOP WEBHOOK] Ignored: no user identifiers found in payload.');
      return NextResponse.json({ received: true, ignored: true });
    }

    const where = email ? { email } : { whopId: whopUserId! };

    // ── Route by event type ────────────────────────────────────────────────
    switch (eventType) {
      case 'membership_activated':
      case 'membership_updated':
      case 'payment_succeeded':
      case 'membership.went_valid': {
        const stringified = JSON.stringify(payload).toLowerCase();
        let assignedTier = 'FREE'; let assignedQuota = 0;
        if (stringified.includes('micro')) { assignedTier = 'MICRO_PILOT'; assignedQuota = 25; }
        else if (stringified.includes('enterprise')) { assignedTier = 'ENTERPRISE'; assignedQuota = 20000; }
        else if (stringified.includes('core')) { assignedTier = 'CORE'; assignedQuota = 500; }

        await prisma.user.upsert({
          where: { whopId: whopUserId || "unknown" },
          update: {
            tier: assignedTier,
            monthlyQuota: assignedQuota,
            leadsProcessed: 0,
          },
          create: {
            whopId: whopUserId || "unknown",
            email: email || "unknown@example.com",
            tier: assignedTier,
            monthlyQuota: assignedQuota,
            leadsProcessed: 0,
          }
        });

        console.log(
          `[WHOP WEBHOOK] ✅ Upgraded to ${assignedTier} (quota: ${assignedQuota})` +
          ` for ${email ?? whopUserId} (plan: "${planName || 'unknown'}")`
        );
        break;
      }

      case 'membership_cancelled':
      case 'membership.went_invalid':
      case 'payment_failed': {
        await prisma.user.updateMany({
          where,
          data: {
            tier:           TIER_CONFIG.FREE.tier,
            monthlyQuota:   TIER_CONFIG.FREE.monthlyQuota,
            leadsProcessed: 0,
          },
        });

        console.log(
          `[WHOP WEBHOOK] 🔒 Account locked to FREE for ${email ?? whopUserId} (event: ${eventType})`
        );
        break;
      }

      default:
        console.log(`[WHOP WEBHOOK] ℹ️ Unhandled event "${eventType}" — acknowledged without mutation.`);
    }

    return NextResponse.json({ received: true });

  } catch (error) {
    console.error('[WHOP WEBHOOK] 💥 Catastrophic failure:', error);
    // Always 200 so Whop does not queue retries for a transient crash
    return NextResponse.json({ received: true, error: 'internal_error' }, { status: 200 });
  }
}
