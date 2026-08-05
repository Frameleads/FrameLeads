// ────────────────────────────────────────────────────────────────────────
// PHASE 2: REPLY INGESTION CONTROLLER
//
// This is the entrypoint for ALL inbound prospect replies. It receives
// the raw reply payload, passes it through the ThermalClassifier (the
// single source of truth), and then routes the classified signal into
// the Velvet Rope Protocol based on the thermal score.
//
// ARCHITECTURAL CONSTRAINT:
// This controller does NOT have its own classification logic. It is a
// thin orchestration layer that delegates to ThermalClassifier.
// Micro-Commitment replies are NOT special-cased here — they enter
// through the same endpoint and get the same treatment as any other
// campaign reply. The campaignType is logged for analytics only.
//
// VELVET ROPE ROUTING:
//   HOT  → Immediately persisted as a PENDING InboundSignal for
//           human approval in the Inbox Triage queue.
//   WARM → Queued for AI-assisted draft generation, then persisted
//           as PENDING for human review.
//   COLD → Auto-archived. No human review required.
// ────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  classifyReply,
  type InboundReply,
  type ThermalClassification,
} from "@/lib/thermal-classifier";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const payload = await req.json();

    // ── Input validation ───────────────────────────────────────────
    const reply: InboundReply = {
      replyId: payload.replyId || `reply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      leadId: payload.leadId || "unknown",
      campaignId: payload.campaignId || "unknown",
      campaignType: payload.campaignType || "custom",
      channel: payload.channel || "email",
      body: payload.body || "",
      receivedAt: payload.receivedAt || new Date().toISOString(),
      originalOutbound: payload.originalOutbound,
      pipelineValue: payload.pipelineValue,
    };

    if (!reply.body.trim()) {
      return NextResponse.json(
        { success: false, error: "Empty reply body — no signal to classify." },
        { status: 400 }
      );
    }

    // ── Step 1: Thermal Classification ─────────────────────────────
    // ALL replies — including Micro-Commitment campaign replies — are
    // routed through the same ThermalClassifier. There is no branching
    // based on campaignType. This is the single source of truth.
    const classification: ThermalClassification = classifyReply(reply);

    console.log(
      `[REPLY INGESTION] ${reply.replyId} | ` +
      `Campaign: ${reply.campaignType} | ` +
      `Channel: ${reply.channel} | ` +
      `Score: ${classification.score} | ` +
      `Confidence: ${classification.confidence.toFixed(2)} | ` +
      `Routing: ${classification.routingAction}`
    );

    // ── Step 2: Velvet Rope Routing ────────────────────────────────
    // The routing decision is determined ENTIRELY by the thermal score.
    // The Velvet Rope Protocol ensures that no outbound reply is ever
    // sent without human approval for HOT and WARM signals.

    switch (classification.routingAction) {
      case "fast_track_triage": {
        // HOT — Immediately create an InboundSignal for human review.
        // This appears in the Inbox Triage queue as a high-priority event.
        const signal = await prisma.inboundSignal.create({
          data: {
            prospectName: reply.leadId,
            prospectContext: `${reply.campaignType} campaign | ${reply.channel} reply | Pipeline: $${(reply.pipelineValue ?? 0).toLocaleString()}`,
            pipelineValue: reply.pipelineValue ?? 0,
            dealStage: "Active Engagement",
            rawEmail: reply.body,
            intentRisk: "High",
            intentType: classification.score,
            aiDraft: "", // No AI draft for HOT — human writes the response.
            status: "PENDING",
          },
        });

        return NextResponse.json({
          success: true,
          replyId: reply.replyId,
          classification: {
            score: classification.score,
            reasoning: classification.reasoning,
            confidence: classification.confidence,
          },
          routing: {
            action: classification.routingAction,
            signalId: signal.id,
            message: "Fast-tracked to Inbox Triage. Human approval required.",
          },
        });
      }

      case "queue_ai_draft": {
        // WARM — Create an InboundSignal with a placeholder for AI draft.
        // The Triage UI will trigger /api/triage to generate the response
        // draft, which the human then reviews before sending.
        const signal = await prisma.inboundSignal.create({
          data: {
            prospectName: reply.leadId,
            prospectContext: `${reply.campaignType} campaign | ${reply.channel} reply | Pipeline: $${(reply.pipelineValue ?? 0).toLocaleString()}`,
            pipelineValue: reply.pipelineValue ?? 0,
            dealStage: "Needs Nurture",
            rawEmail: reply.body,
            intentRisk: "Medium",
            intentType: classification.score,
            aiDraft: "Queued for AI-assisted draft generation. Click 'Regenerate Draft' to generate.",
            status: "PENDING",
          },
        });

        return NextResponse.json({
          success: true,
          replyId: reply.replyId,
          classification: {
            score: classification.score,
            reasoning: classification.reasoning,
            confidence: classification.confidence,
          },
          routing: {
            action: classification.routingAction,
            signalId: signal.id,
            message: "Queued for AI draft generation. Human review required after draft.",
          },
        });
      }

      case "auto_archive": {
        // COLD — Log the classification but do NOT create a triage signal.
        // The reply is archived silently. No human bandwidth is consumed.
        // In production, this would write to an analytics/archive table.
        console.log(
          `[REPLY INGESTION] Auto-archived COLD reply ${reply.replyId}: "${reply.body.slice(0, 80)}..."`
        );

        return NextResponse.json({
          success: true,
          replyId: reply.replyId,
          classification: {
            score: classification.score,
            reasoning: classification.reasoning,
            confidence: classification.confidence,
          },
          routing: {
            action: classification.routingAction,
            signalId: null,
            message: "Auto-archived. No human review required.",
          },
        });
      }

      default: {
        // Defensive — should never reach here, but if it does, escalate.
        return NextResponse.json(
          {
            success: false,
            error: `Unknown routing action: ${classification.routingAction}`,
          },
          { status: 500 }
        );
      }
    }
  } catch (error) {
    console.error("[REPLY INGESTION] Catastrophic failure:", error);
    return NextResponse.json(
      { success: false, error: "Reply ingestion pipeline failure." },
      { status: 500 }
    );
  }
}
