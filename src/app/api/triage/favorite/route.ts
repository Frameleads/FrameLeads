export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifiedCustomerUser } from '@/lib/customer-session';
import { requireFeatureAccess } from '@/lib/auth-guard';

export async function POST(request: Request) {
  try {
    const authError = await requireFeatureAccess('INBOX_TRIAGE');
    if (authError) return authError;

    const userId = (await verifiedCustomerUser())?.id;
    if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });

    const payload = await request.json().catch(() => null);
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!id || typeof payload?.isFavorite !== 'boolean') {
      return NextResponse.json({ success: false, error: 'Signal ID and favorite state are required.' }, { status: 400 });
    }

    const signal = await prisma.inboundSignal.findFirst({ where: { id, userId }, select: { id: true } });
    if (!signal) return NextResponse.json({ success: false, error: 'Signal not found.' }, { status: 404 });

    await prisma.inboundSignal.update({ where: { id }, data: { isFavorite: payload.isFavorite } });
    return NextResponse.json({ success: true, isFavorite: payload.isFavorite });
  } catch (error) {
    console.error('[TRIAGE FAVORITE ERROR]:', error);
    return NextResponse.json({ success: false, error: 'Unable to update favorite.' }, { status: 500 });
  }
}
