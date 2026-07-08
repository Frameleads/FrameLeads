import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    console.log('[WHOP WEBHOOK] Signal Received:', payload?.action || 'unknown_event');

    // Extract identifier defensively depending on Whop's nested structure
    const data = payload?.data || payload;
    const email = data?.user?.email || data?.email;
    const whopId = data?.user?.id || data?.whop_id || data?.id;

    if (!email && !whopId) {
      console.warn('[WHOP WEBHOOK] Ignored: Malformed payload missing user identifiers.');
      return NextResponse.json({ received: true, ignored: true });
    }

    // Execute the aggressive upgrade
    if (email) {
      await prisma.user.updateMany({
        where: { email: email },
        data: { tier: 'ENTERPRISE' }
      });
    } else if (whopId) {
      await prisma.user.updateMany({
        where: { whopId: whopId },
        data: { tier: 'ENTERPRISE' }
      });
    }

    console.log(`[WHOP WEBHOOK] Identity upgraded to ENTERPRISE for ${email || whopId}`);
    return NextResponse.json({ received: true });

  } catch (error) {
    console.error('[WHOP WEBHOOK] Catastrophic failure during processing:', error);
    // Always return 200 so the provider knows the endpoint is alive and doesn't queue retries
    return NextResponse.json({ received: true, error: 'internal_error' }, { status: 200 });
  }
}
