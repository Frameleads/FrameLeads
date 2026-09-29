import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { deleteMarketProfile, saveMarketProfile } from '@/lib/market-messaging';

export const dynamic = 'force-dynamic';
async function owner() {
  const jar = await cookies();
  return (await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value))?.id;
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await owner();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params, body = await request.json().catch(() => null);
  try { return NextResponse.json({ profile: await saveMarketProfile({ userId, id, data: body }) }); }
  catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && error.message.includes('not found')) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof Error && (error.message.includes('overlap') || error.message.includes('P2034'))) return NextResponse.json({ error: 'An enabled profile already claims one of those countries. Refresh and try again.' }, { status: 409 });
    console.error('[MARKET PROFILE] Update failed', error); return NextResponse.json({ error: 'Market profile could not be saved.' }, { status: 500 });
  }
}
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await owner();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await context.params;
    if (!await deleteMarketProfile(userId, id)) return NextResponse.json({ error: 'Market profile not found.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) { console.error('[MARKET PROFILE] Delete failed', error); return NextResponse.json({ error: 'Market profile could not be deleted.' }, { status: 500 }); }
}
