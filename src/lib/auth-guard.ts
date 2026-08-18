import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function requireEnterpriseTier() {
  const cookieStore = await cookies();
  const session = cookieStore.get('frameleads_session')?.value;

  const email = cookieStore.get('user_email')?.value;
  if (!email) {
    return NextResponse.json(
      { success: false, error: "Unauthorized: Missing identity." },
      { status: 403 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { tier: true }
  });

  if (!user || user.tier !== 'ENTERPRISE') {
    return NextResponse.json(
      { success: false, error: "Payment Required: Enterprise tier strictly required for this Velvet Rope feature." },
      { status: 402 }
    );
  }

  return null; // Authorized
}

export async function requireMinimumCoreTier() {
  const cookieStore = await cookies();
  const session = cookieStore.get('frameleads_session')?.value;

  const email = cookieStore.get('user_email')?.value;
  if (!email) {
    return NextResponse.json({ success: false, error: "Unauthorized: Missing identity." }, { status: 403 });
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { tier: true } });

  if (!user || !['CORE', 'ENTERPRISE'].includes(user.tier)) {
    return NextResponse.json(
      { success: false, error: "Payment Required: Deploy feature requires Core tier or higher." },
      { status: 402 }
    );
  }

  return null;
}
