import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma'; // Adjust import path if necessary

export async function POST(req: Request) {
  try {
    const { signalId, finalText } = await req.json();
    
    // 1. Update Database Status
    await prisma.inboundSignal.update({
      where: { id: signalId },
      data: { status: 'APPROVED' }
    });

    // 2. Simulate Smartlead API Dispatch (Placeholder for actual Smartlead send endpoint)
    console.log(`[OUTBOUND DISPATCH] Signal ${signalId} fired. Payload: "${finalText}"`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Dispatch Error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
