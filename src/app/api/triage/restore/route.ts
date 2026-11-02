export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifiedCustomerUser } from '@/lib/customer-session';
import { requireFeatureAccess } from '@/lib/auth-guard';

/** Move a tenant-owned, soft-trashed signal back into the Active queue.
 * Original signal, favorite flag, and decision history are never deleted.
 */
export async function POST(request: Request) {
  try {
    const authError = await requireFeatureAccess('INBOX_TRIAGE');
    if (authError) return authError;

    const userId = (await verifiedCustomerUser())?.id;
    if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });

    const body = await request.json().catch(() => null);
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ success: false, error: 'Signal ID required.' }, { status: 400 });

    // Scope ownership and the expected state in the write itself to prevent
    // cross-tenant changes and stale/conflicting restorations.
    const result = await prisma.inboundSignal.updateMany({
      where: { id, userId, status: 'TRASHED' },
      data: { status: 'PENDING' },
    });
    if (result.count !== 1) return NextResponse.json({
      success: false, error: 'Trashed signal not found or already restored.',
    }, { status: 404 });

    return NextResponse.json({ success: true, status: 'PENDING' });
  } catch (error) {
    console.error('[TRIAGE RESTORE ERROR]:', error);
    return NextResponse.json({ success: false, error: 'Unable to restore signal.' }, { status: 500 });
  }
}
