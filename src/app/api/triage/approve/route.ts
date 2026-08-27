export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PIPELINE_VALUE } from "@/lib/pipeline-value";
import { requireEnterpriseTier } from "@/lib/auth-guard";

export async function POST(req: Request) {
  try {
    const authError = await requireEnterpriseTier();
    if (authError) return authError;

    const cookieStore = await cookies();
    const email = cookieStore.get("user_email")?.value;
    const user = email
      ? await prisma.user.findUnique({
          where: { email: email.trim().toLowerCase() },
          select: { id: true },
        })
      : null;

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const {
      signalId,
      subject,
      finalText,
      campaignId,
      leadId,
      apiKey,
    } = await req.json();

    if (!signalId || !finalText) {
      return NextResponse.json(
        { success: false, error: "signalId and finalText are required." },
        { status: 400 }
      );
    }

    const signal = await prisma.inboundSignal.findFirst({
      where: { id: signalId, userId: user.id },
      select: { id: true },
    });

    if (!signal) {
      return NextResponse.json({ success: false, error: "Signal not found." }, { status: 404 });
    }

    let dispatched = false;
    if (apiKey && campaignId && leadId) {
      const smartleadRes = await fetch(
        `https://server.smartlead.ai/api/v1/campaigns/${campaignId}/leads/${leadId}/reply?api_key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email_body: finalText,
            subject: subject || "Re: Technical Review",
            reply_to_message_id: signalId,
          }),
        }
      );

      if (!smartleadRes.ok) {
        const errorText = await smartleadRes.text().catch(() => "Unknown Smartlead error");
        console.error("[TRIAGE APPROVE] Smartlead dispatch failed:", smartleadRes.status, errorText);
        return NextResponse.json(
          { success: false, error: `Smartlead API error: ${smartleadRes.status}` },
          { status: 502 }
        );
      }
      dispatched = true;
    }

    await prisma.$transaction([
      prisma.inboundSignal.updateMany({
        where: { id: signalId, userId: user.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          aiDraft: finalText,
        },
      }),
      prisma.inboundSignal.updateMany({
        where: { id: signalId, userId: user.id, pipelineValue: { lte: 0 } },
        data: { pipelineValue: DEFAULT_PIPELINE_VALUE },
      }),
    ]);

    return NextResponse.json({
      success: true,
      status: "APPROVED",
      dispatched,
      message: dispatched
        ? "Draft response sent and approved."
        : "Draft approved and saved. No sending-provider credentials were supplied.",
    });
  } catch (error) {
    console.error("[TRIAGE APPROVE] Approval failed:", error);
    return NextResponse.json(
      { success: false, error: "Unable to approve this signal." },
      { status: 500 }
    );
  }
}
