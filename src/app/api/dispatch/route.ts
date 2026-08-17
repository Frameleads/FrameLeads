import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
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
    await prisma.inboundSignal.update({
      where: { id: leadId },
      data: { status: 'APPROVED' }
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Dispatch Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
