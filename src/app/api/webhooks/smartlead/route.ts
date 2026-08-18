import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { extractApiKey, verifyApiKey } from '@/lib/webhook-auth';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: Request) {
  try {
    const rawKey = extractApiKey(req);
    if (!rawKey) {
      return NextResponse.json({ success: false, error: 'Missing FrameLeads API key' }, { status: 401 });
    }
    const auth = await verifyApiKey(rawKey);
    if (!auth.authenticated || !auth.userId) {
      return NextResponse.json({ success: false, error: auth.error || 'Invalid API key' }, { status: 401 });
    }

    const { lead_name, lead_email, company_name, reply_text, deal_value, deal_stage } = await req.json();

    if (!lead_name || !reply_text) {
      return NextResponse.json({ success: false, error: 'lead_name and reply_text are required' }, { status: 400 });
    }
    
    // Process inbound signal through Gemini
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: "You are an elite cognitive architecture responding to high-ticket B2B objections. Your objective is to sell indirectly by shifting the prospect's worldview. Do not argue. Acknowledge their friction, reframe the paradigm, and position our infrastructure as the inevitable, mathematically superior outcome. Use a candid, visceral, high-status tone. No soft corporate jargon. Keep it under 4 sentences. End with a low-friction CTA."
    });

    const prompt = `Prospect Name: ${lead_name}. Inbound Message: "${reply_text}". Deal Value: $${deal_value}.`;
    const result = await model.generateContent(prompt);
    const aiDraft = result.response.text();

    // Write event to the InboundSignal table
    await prisma.inboundSignal.create({
      data: {
        userId: auth.userId,
        prospectName: lead_name,
        prospectEmail: lead_email || null,
        prospectContext: company_name || '',
        pipelineValue: Number(deal_value) || 0,
        dealStage: deal_stage || 'Inbound Reply',
        rawEmail: reply_text,
        intentRisk: 'HIGH', // Default/placeholder
        intentType: 'OBJECTION', // Default/placeholder
        aiDraft: aiDraft,
        status: 'PENDING',
      }
    });

    // Immediately return 200 OK so Smartlead does not endlessly retry
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Webhook Execution Error:", error);
    
    // Return 200 OK gracefully to prevent webhook retries even on parse failure
    return NextResponse.json({ success: false, error: 'Malformed payload handled securely' }, { status: 200 });
  }
}
