import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DEFAULT_PIPELINE_VALUE } from '@/lib/pipeline-value';
import { requireFeatureAccess } from '@/lib/auth-guard';
import { verifiedCustomerUser } from '@/lib/customer-session';

export async function POST(req: Request) {
  try {
    const authError = await requireFeatureAccess('INBOX_TRIAGE');
    if (authError) return authError;
    const user = await verifiedCustomerUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const account = await prisma.user.findUnique({ where: { id: user.id }, select: { tier: true } });
    if (account?.tier === 'MICRO_PILOT') return NextResponse.json({ success: false,
      error: 'Use the governed Decision approval flow for Micro-Pilot replies.' }, { status: 403 });

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
    const [updated] = await prisma.$transaction([
      prisma.inboundSignal.updateMany({
        where: { id: leadId, userId: user.id },
        data: { status: 'APPROVED', approvedAt: new Date() },
      }),
      prisma.inboundSignal.updateMany({
        where: { id: leadId, userId: user.id, pipelineValue: { lte: 0 } },
        data: { pipelineValue: DEFAULT_PIPELINE_VALUE },
      }),
    ]);

    if (updated.count === 0) {
      return NextResponse.json({ success: false, error: 'Signal not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Dispatch Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
