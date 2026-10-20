import Anthropic from '@anthropic-ai/sdk';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { requireFeatureAccess } from '@/lib/auth-guard';
import { prisma } from '@/lib/prisma';
import { formatIntentTemperature, intentTemperature, isHighPriorityIntent } from '@/lib/intent-temperature';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SYSTEM_PROMPT = `You are an elite B2B sales engineer analyzing an inbound email reply. You must return a strict JSON object with no markdown formatting.

1. "intentScore": Prospect interest, from 0-100; use null if unavailable. This is separate from classification confidence.
- 0-59: Rejection, unsubscribe, or no buying interest.
- 60-79: Soft interest, asking for information, or deferring timeline.
- 80-100: Direct meeting request, pricing inquiry, or explicit high intent.
2. "category": Strictly "HOT", "WARM", or "COLD".
3. "signals": An array of max 3 string tags extracted strictly from the text. YOU MUST ONLY CHOOSE FROM THIS EXACT LIST: ["Meeting Requested", "Pricing Inquiry", "Referred to Colleague", "Competitor Mentioned", "Timing Objection", "Requesting Resources", "OOTO / Bounced"]. Do not invent tags.
4. "strategy": A 2-sentence diagnostic strategy for the rep.
5. "draftResponse": A concise, highly professional B2B email reply (max 3 sentences). If the lead suggests a specific time or date, you MUST acknowledge and confirm it in this draft. If they object, handle it smoothly. Keep the tone matching a luxury minimalist brand.`;

const ALLOWED_SIGNALS = new Set([
  'Meeting Requested',
  'Pricing Inquiry',
  'Referred to Colleague',
  'Competitor Mentioned',
  'Timing Objection',
  'Requesting Resources',
  'OOTO / Bounced',
]);

type IntentCategory = 'HOT' | 'WARM' | 'COLD' | 'UNASSESSED';

interface TriageClassification {
  intentScore: number;
  category: IntentCategory;
  signals: string[];
  strategy: string;
  draftResponse: string;
}

function parseClaudeJson(rawContent: string): unknown {
  const cleanedContent = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(cleanedContent);
  } catch {
    // Also tolerate accidental prose surrounding an otherwise valid JSON object.
  }

  const firstBrace = cleanedContent.indexOf('{');
  const lastBrace = cleanedContent.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Claude returned an invalid classification payload.');
  }

  return JSON.parse(cleanedContent.substring(firstBrace, lastBrace + 1));
}

function normalizeStrategy(value: unknown) {
  const fallback = 'Review the reply against its explicit language before taking action. Ask one direct follow-up question if the sender’s intent remains unclear.';
  if (typeof value !== 'string' || !value.trim()) return fallback;

  const sentences = value.trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) || [];
  if (sentences.length >= 2) return sentences.slice(0, 2).join(' ');
  if (sentences.length === 1) {
    const firstSentence = /[.!?]$/.test(sentences[0]) ? sentences[0] : `${sentences[0]}.`;
    return `${firstSentence} Ask one direct follow-up question to confirm the sender’s intent.`;
  }
  return fallback;
}

function normalizeDraftResponse(value: unknown) {
  const fallback = 'Thank you for the reply. I will review the details and follow up shortly.';
  if (typeof value !== 'string' || !value.trim()) return fallback;

  const sentences = value.trim()
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.slice(0, 3).join(' ') || fallback;
}

function normalizeClassification(value: unknown): TriageClassification {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const numericScore = typeof raw.intentScore === 'number' ? raw.intentScore : Number.NaN;
  const intentScore = Number.isFinite(numericScore) && numericScore >= 0 && numericScore <= 100
    ? Math.round(numericScore)
    : null;
  const signals = Array.isArray(raw.signals)
    ? Array.from(new Set(
        raw.signals.filter(
          (signal): signal is string => typeof signal === 'string' && ALLOWED_SIGNALS.has(signal),
        ),
      )).slice(0, 3)
    : [];

  return {
    intentScore: intentScore ?? 0,
    category: intentTemperature(intentScore) ?? 'UNASSESSED',
    signals,
    strategy: normalizeStrategy(raw.strategy),
    draftResponse: normalizeDraftResponse(raw.draftResponse),
  };
}

function unavailableClassification(): TriageClassification {
  return {
    intentScore: 0,
    category: 'UNASSESSED',
    signals: [],
    draftResponse: 'Thank you for the reply. I will review the details and follow up shortly.',
    strategy: 'AI classification is unavailable, so review the reply manually. Do not act until a rep confirms the sender’s intent.',
  };
}

export async function POST(request: Request) {
  try {
    const authError = await requireFeatureAccess('DECISION_ENGINE');
    if (authError) return authError;

    const payload = await request.json().catch(() => null);
    let inboundSignal = typeof payload?.inboundSignal === 'string'
      ? payload.inboundSignal.trim()
      : '';
    let persistedSignal: { id: string; userId: string } | null = null;

    if (typeof payload?.signalId === 'string' && payload.signalId.trim()) {
      const cookieStore = await cookies();
      const userEmail = cookieStore.get('user_email')?.value;
      const user = userEmail
        ? await prisma.user.findUnique({
            where: { email: userEmail.trim().toLowerCase() },
            select: { id: true },
          })
        : null;

      if (!user) {
        return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
      }

      const signal = await prisma.inboundSignal.findFirst({
        where: { id: payload.signalId.trim(), userId: user.id },
        select: { id: true, userId: true, rawEmail: true },
      });
      if (!signal?.userId) {
        return NextResponse.json({ success: false, error: 'Signal not found.' }, { status: 404 });
      }

      persistedSignal = { id: signal.id, userId: signal.userId };
      inboundSignal = signal.rawEmail.trim();
    }

    if (!inboundSignal) {
      return NextResponse.json(
        { success: false, error: 'Missing inbound signal.' },
        { status: 400 },
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    let classification = unavailableClassification();

    if (apiKey) {
      const anthropic = new Anthropic({ apiKey });
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Inbound email reply:\n\n${inboundSignal}` }],
      });
      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Claude returned no classification text.');
      }
      const parsedData = parseClaudeJson(textBlock.text);
      classification = normalizeClassification(parsedData);
    }

    if (persistedSignal) {
      await prisma.inboundSignal.updateMany({
        where: { id: persistedSignal.id, userId: persistedSignal.userId },
        data: {
          intentScore: classification.intentScore,
          intentType: classification.category,
          intentRisk: classification.signals.join(', '),
          signals: classification.signals,
          signalAnalysis: classification.strategy,
          aiDraft: classification.draftResponse,
          isHighPriority: isHighPriorityIntent(classification.category === 'UNASSESSED' ? null : classification.intentScore),
        },
      });
    }

    return NextResponse.json({ success: true, ...classification,
      temperatureLabel: classification.category === 'UNASSESSED' ? formatIntentTemperature(null) : formatIntentTemperature(classification.intentScore) });
  } catch (error) {
    console.error('[TRIAGE CLASSIFICATION ERROR]:', error);
    return NextResponse.json(
      { success: false, error: 'Triage classification failed.' },
      { status: 500 },
    );
  }
}
