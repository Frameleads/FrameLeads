import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    
    // 1. Extract Event and Identifiers
    const eventType = payload?.event || payload?.type || payload?.action || 'unknown';
    const email = payload?.data?.user?.email || payload?.data?.email;
    const whopUserId = payload?.data?.user?.id || payload?.data?.id;

    if (!email && !whopUserId) {
      return NextResponse.json({ received: true, ignored: true });
    }

    // 2. The Correct Email Query
    const where = email ? { email } : { whopId: whopUserId };

    // 3. The Activation Logic
    if (eventType === 'membership_activated' || eventType === 'payment_succeeded' || eventType === 'membership_updated' || eventType === 'membership.went_valid') {
        const payloadString = JSON.stringify(payload).toLowerCase();
        let assignedTier = 'FREE'; 
        let assignedQuota = 0;

        if (/\bmicro\b/.test(payloadString)) { 
            assignedTier = 'MICRO_PILOT'; 
            assignedQuota = 25; 
        } else if (/\benterprise\b/.test(payloadString)) { 
            assignedTier = 'ENTERPRISE'; 
            assignedQuota = 20000; 
        } else if (/\bcore\b/.test(payloadString)) { 
            assignedTier = 'CORE'; 
            assignedQuota = 500; 
        }

        await prisma.user.upsert({
          where: where,
          update: { tier: assignedTier, monthlyQuota: assignedQuota, leadsProcessed: 0 },
          create: { whopId: whopUserId || "unknown", email: email || "unknown@example.com", tier: assignedTier, monthlyQuota: assignedQuota, leadsProcessed: 0 }
        });

        console.log(`[WHOP WEBHOOK] ✅ Upgraded to ${assignedTier} (Quota: ${assignedQuota}) for ${email || whopUserId}`);
        return NextResponse.json({ received: true, success: true });
    } 
    
    // 4. The Cancellation Logic
    if (eventType === 'membership_cancelled' || eventType === 'membership.went_invalid' || eventType === 'payment_failed') {
        await prisma.user.updateMany({
          where: where,
          data: { tier: 'FREE', monthlyQuota: 0, leadsProcessed: 0 },
        });
        console.log(`[WHOP WEBHOOK] 🔒 Downgraded to FREE for ${email || whopUserId}`);
        return NextResponse.json({ received: true, success: true });
    }

    // 5. Unhandled Fallback
    console.log(`[WHOP WEBHOOK] Unhandled event "${eventType}" - acknowledged without mutation.`);
    return NextResponse.json({ received: true });

  } catch (error) {
    console.error('[WHOP WEBHOOK] 💥 Error:', error);
    return NextResponse.json({ received: true }, { status: 200 });
  }
}