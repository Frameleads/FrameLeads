import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { requireEnterpriseTier } from '@/lib/auth-guard';

export async function POST(req: Request) {
  try {
    const authError = await requireEnterpriseTier();
    if (authError) return authError;
    const cookieStore = await cookies();
    const email = cookieStore.get('user_email')?.value;
    const user = email ? await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } }) : null;
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { leadId, replyText, leadEmail } = await req.json();

    if (!leadId || !replyText || !leadEmail) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // TODO: Execute outbound API call to Smartlead/Instantly
    // fetch('https://api.smartlead.ai/v1/campaigns/...', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${process.env.SMARTLEAD_API_KEY}`,
    //     'Content-Type': 'application/json'
    //   },
    //   body: JSON.stringify({ email: leadEmail, text: replyText })
    // });
    
    // Update the InboundSignal lifecycle status to APPROVED
    const updated = await prisma.inboundSignal.updateMany({
      where: { id: leadId, userId: user.id },
      data: { status: 'APPROVED', approvedAt: new Date() }
    });

    if (updated.count === 0) {
      return NextResponse.json({ success: false, error: 'Signal not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Dispatch Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
