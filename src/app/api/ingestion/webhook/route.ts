// ────────────────────────────────────────────────────────────────────────
// PHASE 4: SIGNAL INGESTION WEBHOOK
//
// ROUTE: POST /api/ingestion/webhook
//
// This is the primary entrypoint for real-time buying signals from
// external tools (Clay, Phantombuster, custom scrapers). When a signal
// arrives, this controller executes the following pipeline:
//
//   1. AUTHENTICATE — Verify the API key via X-FrameLeads-Api-Key header.
//   2. NORMALIZE    — Parse the raw payload into a unified schema using
//                     the signal normalizer.
//   3. DRAFT        — Invoke the LLM to generate a hyper-contextual
//                     "Trojan Horse" outreach message acknowledging
//                     the specific signal.
//   4. GATE         — Pass the draft through the Phase 2 word-count
//                     gate (75-word limit with retry logic).
//   5. ENQUEUE      — Write the signal and draft into the database as
//                     a PENDING InboundSignal with `isHighPriority: true`
//                     and `sourceType: 'SIGNAL_TRIGGERED'`.
//
// The Velvet Rope Protocol is enforced: the signal is NEVER auto-sent.
// It sits in the Inbox Triage queue until a human approves it with
// a single click.
// ────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";
import { extractApiKey, verifyApiKey } from "@/lib/webhook-auth";
import { normalizeSignalPayload, type NormalizedSignal } from "@/lib/signal-normalizer";
import {
  enforceWordLimit,
  truncateToLimit,
  OUTBOUND_WORD_LIMIT,
  MAX_RETRIES,
} from "@/lib/word-count-gate";

export const dynamic = "force-dynamic";

// ── Trojan Horse System Prompt ──────────────────────────────────────────
// This prompt generates a SIGNAL-AWARE outreach message. Unlike the
// standard outbound generation prompt, this one is specifically designed
// to reference the trigger event (funding round, job change, etc.) as
// the opening hook — making the outreach feel like a timely, relevant
// observation rather than a cold pitch.
//
// CRITICAL: The output is a SINGLE message body (not multi-channel).
// Signal-triggered messages are high-priority, 1-to-1 communications
// that go through human review. They don't need LinkedIn/WhatsApp variants.
// ─────────────────────────────────────────────────────────────────────────

const TROJAN_HORSE_PROMPT = `You are an elite Systems Architect writing a hyper-contextual outbound message. A real-time buying signal has been detected for this prospect. Your job is to write a short, high-conviction "Trojan Horse" message that:

1. Opens by ACKNOWLEDGING the specific signal event (funding round, new hire, tech stack shift, etc.) as a natural observation — not a congratulations, not a pitch.
2. Connects the signal to a SPECIFIC operational consequence they are likely now facing (e.g., "Post-Series B, most founders discover their outbound infrastructure doesn't scale with their new growth mandate").
3. Positions FrameLeads autonomous acquisition infrastructure as the logical architecture decision for their current inflection point.
4. Closes with a LOW-FRICTION ask (send a diagnostic, share an architecture memo, or a 90-second walkthrough).

STRICT CONSTRAINTS:
- Maximum ${OUTBOUND_WORD_LIMIT} words. This is a hard limit. Be surgically concise.
- NO congratulations. NO "I saw your funding round, congrats!" — this is commodity language.
- NO filler phrases: "I hope this finds you well", "I wanted to reach out", "I'd love to connect".
- Write as a peer CTO/founder observing a structural pattern, not a salesperson.
- Output ONLY the message body text. No subject line, no JSON, no formatting.`;

// ── Draft Generation ────────────────────────────────────────────────────

/**
 * Generates a Trojan Horse draft using the LLM, enforcing the 75-word
 * gate with retry logic.
 *
 * @param signal — The normalized signal data.
 * @returns      — The word-count-compliant draft text.
 */
async function generateTrojanHorseDraft(
  signal: NormalizedSignal
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || "";

  // ── Fallback: no API key configured ────────────────────────────
  if (!apiKey) {
    const fallback =
      `${signal.prospectName} — ${signal.signalType.replace(/_/g, " ").toLowerCase()} ` +
      `at ${signal.companyName} signals an inflection point in your operational architecture. ` +
      `Most teams at this stage discover their outbound infrastructure doesn't scale with the new mandate. ` +
      `FrameLeads engineers autonomous acquisition systems that abstract that scaling constraint entirely. ` +
      `Worth a 90-second walkthrough of the architecture?`;
    return truncateToLimit(fallback, OUTBOUND_WORD_LIMIT);
  }

  // ── LLM Generation with word-count retry loop ──────────────────
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: TROJAN_HORSE_PROMPT,
    generationConfig: {
      temperature: 0.75,
    },
  });

  const userPrompt = `Generate a Trojan Horse message for this signal:

Prospect: ${signal.prospectName}
Company: ${signal.companyName}
Signal Type: ${signal.signalType}
Signal Details: ${signal.rawSignalText}

Write the message body only. Maximum ${OUTBOUND_WORD_LIMIT} words.`;

  let draft = "";
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    try {
      const retryInstruction =
        attempt > 0
          ? `\n\nPREVIOUS ATTEMPT EXCEEDED ${OUTBOUND_WORD_LIMIT} WORDS. Be more concise. Cut ruthlessly.`
          : "";

      const result = await model.generateContent(userPrompt + retryInstruction);
      draft = result.response.text().trim();

      // ── Phase 2 Word-Count Gate enforcement ──────────────────────
      // Context is 'outbound' — this is a signal-triggered outbound
      // message, NOT a triage objection response. The 75-word gate
      // applies here.
      const validation = enforceWordLimit(draft, "outbound");

      if (validation.passed) {
        break; // Draft is within limit — proceed.
      }

      console.warn(
        `[SIGNAL DRAFT] Word-count gate FAILED (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ` +
        `${validation.wordCount} words (limit: ${OUTBOUND_WORD_LIMIT})`
      );
    } catch (err) {
      console.error(`[SIGNAL DRAFT] LLM generation error (attempt ${attempt + 1}):`, err);
    }

    attempt++;
  }

  // If all retries exhausted, force-truncate the best attempt.
  if (!draft) {
    return truncateToLimit(
      `${signal.prospectName} — a structural shift at ${signal.companyName} ` +
      `suggests your outbound architecture is entering an inflection point. ` +
      `FrameLeads engineers autonomous acquisition infrastructure for exactly this transition. ` +
      `Worth a 90-second walkthrough?`,
      OUTBOUND_WORD_LIMIT
    );
  }

  return truncateToLimit(draft, OUTBOUND_WORD_LIMIT);
}

// ── Route Handler ───────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    // ── Step 1: AUTHENTICATION ────────────────────────────────────────
    const rawKey = extractApiKey(req);

    if (!rawKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing API key. Include your key via the X-FrameLeads-Api-Key header " +
            "or ?token= query parameter.",
        },
        { status: 401 }
      );
    }

    const auth = await verifyApiKey(rawKey);

    if (!auth.authenticated) {
      console.warn(
        `[SIGNAL WEBHOOK] Authentication FAILED. Error: ${auth.error}`
      );
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: 401 }
      );
    }

    // ── Step 2: PARSE & NORMALIZE ────────────────────────────────────
    let rawPayload: Record<string, any>;

    try {
      rawPayload = await req.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "Malformed JSON payload. Ensure the request body is valid JSON " +
            "with Content-Type: application/json.",
        },
        { status: 400 }
      );
    }

    const normalization = normalizeSignalPayload(rawPayload);

    if (!normalization.success || !normalization.signal) {
      console.warn(
        `[SIGNAL WEBHOOK] Normalization FAILED for user ${auth.userId}: ${normalization.error}`
      );
      return NextResponse.json(
        {
          success: false,
          error: normalization.error,
          warnings: normalization.warnings,
        },
        { status: 422 }
      );
    }

    const signal = normalization.signal;

    console.log(
      `[SIGNAL WEBHOOK] Signal received for user ${auth.userId}: ` +
      `${signal.signalType} | ${signal.prospectName} @ ${signal.companyName}`
    );

    // ── Step 3: GENERATE TROJAN HORSE DRAFT ──────────────────────────
    // The draft is generated and word-count-gated BEFORE database write.
    // If the LLM fails entirely, we still enqueue with a fallback draft
    // so the signal is never silently lost.
    const aiDraft = await generateTrojanHorseDraft(signal);

    // ── Step 4: ENQUEUE TO VELVET ROPE ───────────────────────────────
    // Write the signal and draft into the InboundSignal table as a
    // PENDING item with high-priority flag and SIGNAL_TRIGGERED source.
    //
    // CRITICAL FLAGS:
    //   isHighPriority: true  — Jumps to top of Inbox Triage queue.
    //   sourceType: 'SIGNAL_TRIGGERED' — Distinguishes from manual triage
    //     entries so the UI can show a "Signal" badge.
    //   signalType: signal.signalType — Categorical tag for filtering
    //     (FUNDING_ROUND, JOB_CHANGE, etc.)
    // ──────────────────────────────────────────────────────────────────

    const inboundSignal = await prisma.inboundSignal.create({
      data: {
        userId: auth.userId!,
        prospectName: signal.prospectName,
        prospectEmail: signal.prospectEmail,
        prospectContext: `${signal.companyName} | Signal: ${signal.signalType.replace(/_/g, " ")}`,
        pipelineValue: 0, // Unknown at signal ingestion — updated during triage.
        dealStage: "Signal Detected",
        rawEmail: signal.rawSignalText,
        intentRisk: "High",
        intentType: signal.signalType,
        aiDraft: aiDraft,
        status: "PENDING",

        // Phase 4 flags
        isHighPriority: true,
        sourceType: "SIGNAL_TRIGGERED",
        signalType: signal.signalType,
      },
    });

    console.log(
      `[SIGNAL WEBHOOK] Enqueued signal ${inboundSignal.id} to Velvet Rope. ` +
      `Priority: HIGH | Source: SIGNAL_TRIGGERED | Type: ${signal.signalType}`
    );

    // ── Step 5: RESPOND ──────────────────────────────────────────────
    return NextResponse.json(
      {
        success: true,
        signalId: inboundSignal.id,
        prospect: {
          name: signal.prospectName,
          email: signal.prospectEmail,
          company: signal.companyName,
        },
        classification: {
          signalType: signal.signalType,
          sourceType: "SIGNAL_TRIGGERED",
          isHighPriority: true,
        },
        governance: {
          draftGenerated: true,
          wordCountEnforced: true,
          enqueuedForHumanReview: true,
          autoSent: false, // NEVER auto-send. Velvet Rope Protocol.
        },
        warnings: normalization.warnings,
        message:
          "Signal ingested and draft generated. Queued in Velvet Rope for human approval.",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[SIGNAL WEBHOOK] Catastrophic pipeline failure:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          "Signal ingestion pipeline failure. The signal was NOT enqueued. " +
          "Check server logs for details.",
      },
      { status: 500 }
    );
  }
}
