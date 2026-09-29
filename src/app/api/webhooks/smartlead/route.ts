import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createInboundSignal, identityFromFullName } from '@/lib/prospects/persistence';
import { resolvePipelineValue } from '@/lib/pipeline-value';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { extractApiKey, verifyApiKey } from '@/lib/webhook-auth';
import { scheduleInboundDecisions } from '@/lib/decision/schedule';
import { getUserEntitlementTier } from '@/lib/auth-guard';
import { hasFeatureAccess } from '@/lib/entitlements';

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

    const payload = await req.json();
    const { lead_name, lead_email, company_name, reply_text, deal_value, deal_stage } = payload;
    const externalId = payload.message_id ?? payload.messageId ?? payload.reply_id ?? payload.replyId;
    const sourceMessageId = typeof externalId === 'string' && externalId.trim() ? externalId.trim().slice(0, 200) : null;

    if (!lead_name || !reply_text) {
      return NextResponse.json({ success: false, error: 'lead_name and reply_text are required' }, { status: 400 });
    }
    
    // Persist the canonical inbound event before any optional provider work.
    const signal = await createInboundSignal(prisma, {
      data: {
        userId: auth.userId, prospectName: lead_name, prospectEmail: lead_email || null,
        prospectContext: company_name || '', pipelineValue: resolvePipelineValue(deal_value),
        dealStage: deal_stage || 'Inbound Reply', rawEmail: reply_text,
        intentRisk: 'Unknown', intentType: 'UNASSESSED', aiDraft: '', status: 'PENDING',
        sourceType: 'WEBHOOK', signalType: 'EMAIL_REPLY', sourceMessageId,
      }
    }, identityFromFullName(lead_name, company_name));
    scheduleInboundDecisions(auth.userId, [signal.id]);

    // Legacy draft generation is optional and cannot reject the saved reply.
    try {
    if (!hasFeatureAccess(await getUserEntitlementTier(auth.userId), 'DECISION_ENGINE'))
      throw new Error('Decision Engine entitlement is unavailable');
    if (!process.env.GEMINI_API_KEY) throw new Error('Legacy draft provider is not configured');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: "You are an elite cognitive architecture responding to high-ticket B2B objections. Your objective is to sell indirectly by shifting the prospect's worldview. Do not argue. Acknowledge their friction, reframe the paradigm, and position our infrastructure as the inevitable, mathematically superior outcome. Use a candid, visceral, high-status tone. No soft corporate jargon. Keep it under 4 sentences. End with a low-friction CTA."
    });

    const prompt = `Prospect Name: ${lead_name}. Inbound Message: "${reply_text}". Deal Value: $${deal_value}.`;
    const result = await model.generateContent(prompt);
    const aiDraft = result.response.text();

    await prisma.inboundSignal.update({ where: { id: signal.id }, data: { aiDraft } });
    } catch {
      console.error('Legacy Smartlead draft failed after inbound persistence');
    }

    // Immediately return 200 OK so Smartlead does not endlessly retry
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Webhook Execution Error:", error);
    
    // Database failures must remain visible and retryable.
    return NextResponse.json({ success: false, error: 'Inbound persistence failed' }, { status: 500 });
  }
}
