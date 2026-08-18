// ────────────────────────────────────────────────────────────────────────
// PHASE 3: PRE-FLIGHT DEPLOYMENT CONTROLLER
//
// This is the FINAL GATEKEEPER before any outbound email leaves the
// FrameLeads infrastructure. It orchestrates two governance checks
// in strict sequence:
//
//   1. DOMAIN ARMOR — Blocks deployment if the sender email uses
//      the user's root brand domain.
//   2. THROTTLE PROTOCOL — Blocks deployment if the sending inbox
//      has exceeded 30 sends today.
//
// Only if BOTH checks pass does the controller proceed to dispatch
// the outbound queue. This is the Velvet Rope Protocol enforced at
// the infrastructure level.
//
// ROUTE: POST /api/deploy/preflight
// This route is called by the Deploy page BEFORE the actual send
// to Smartlead or any other sending provider.
// ────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSenderDomain } from "@/lib/domain-armor";
import {
  preflightBatchCheck,
  recordSend,
} from "@/lib/throttle-protocol";

export const dynamic = "force-dynamic";

import { requireMinimumCoreTier } from '@/lib/auth-guard';

export async function POST(req: Request) {
  try {
    const authError = await requireMinimumCoreTier();
    if (authError) return authError;

    const {
      userId,
      inboxId,
      batchId,
      leadIds,
    } = await req.json();

    // ── Input validation ───────────────────────────────────────────
    if (!userId || !inboxId || !batchId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: userId, inboxId, and batchId are mandatory.",
        },
        { status: 400 }
      );
    }

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Empty deployment queue — no leads to send.",
        },
        { status: 400 }
      );
    }

    // ── Step 1: Resolve user and inbox from database ───────────────
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: "User not found." },
        { status: 404 }
      );
    }

    const inbox = await prisma.sendingInbox.findUnique({
      where: { id: inboxId },
    });

    if (!inbox) {
      return NextResponse.json(
        { success: false, error: "Sending inbox not found." },
        { status: 404 }
      );
    }

    if (inbox.userId !== userId) {
      return NextResponse.json(
        { success: false, error: "Inbox does not belong to this user." },
        { status: 403 }
      );
    }

    // ── Step 2: DOMAIN ARMOR CHECK ─────────────────────────────────
    // This MUST run before the throttle check. If the domain is blocked,
    // we don't want to waste a database query counting sends.
    //
    // The check compares the user's rootBrandDomain (from their profile)
    // against the sender email address on the inbox.
    // ────────────────────────────────────────────────────────────────

    const domainCheck = validateSenderDomain(
      user.rootBrandDomain || "",
      inbox.emailAddress
    );

    if (!domainCheck.passed) {
      console.warn(
        `[DOMAIN ARMOR] BLOCKED deployment for user ${userId}. ` +
        `Sender: ${inbox.emailAddress} | Root domain: ${user.rootBrandDomain} | ` +
        `Error: ${domainCheck.error}`
      );

      return NextResponse.json(
        {
          success: false,
          governance: "domain_blocked",
          error: domainCheck.error,
          details: {
            senderDomain: domainCheck.senderDomain,
            rootBrandDomain: domainCheck.rootBrandDomain,
          },
        },
        { status: 403 }
      );
    }

    // ── Step 3: THROTTLE PROTOCOL CHECK ────────────────────────────
    // Pre-flight batch check: how many of the queued leads can this
    // inbox actually send today without exceeding the 30/day cap?
    // ────────────────────────────────────────────────────────────────

    const throttleCheck = await preflightBatchCheck(
      inboxId,
      leadIds.length
    );

    if (!throttleCheck.allowed) {
      console.warn(
        `[THROTTLE PROTOCOL] HALTED deployment for inbox ${inboxId}. ` +
        `Sent today: ${throttleCheck.sentToday}/${throttleCheck.dailyLimit}. ` +
        `Status: governance_throttled`
      );

      return NextResponse.json(
        {
          success: false,
          governance: "governance_throttled",
          error: throttleCheck.message,
          details: {
            sentToday: throttleCheck.sentToday,
            dailyLimit: throttleCheck.dailyLimit,
            remaining: 0,
            resumesAt: "00:00 UTC",
          },
        },
        { status: 429 }
      );
    }

    // ── Step 4: DEPLOYMENT EXECUTION ───────────────────────────────
    // Both governance checks passed. Proceed with the actual deployment.
    //
    // We slice the lead queue to the deployable count (which may be
    // less than the total queue if the inbox is close to its daily cap).
    //
    // For each successfully sent lead, we record the send in the
    // OutboundLog so future throttle checks account for it.
    // ────────────────────────────────────────────────────────────────

    const deployableLeads = leadIds.slice(0, throttleCheck.deployableCount);
    const deferredLeads = leadIds.slice(throttleCheck.deployableCount);

    // TODO: Replace this with actual Smartlead API dispatch.
    // For now, we record each send in the OutboundLog to enforce
    // the throttle protocol on subsequent deployments.
    const sendResults = [];
    for (const leadId of deployableLeads) {
      try {
        // Record the send AFTER successful dispatch (not before).
        await recordSend(inboxId, leadId, "email");
        sendResults.push({ leadId, status: "sent" });
      } catch (err) {
        console.error(`[DEPLOY] Failed to record send for lead ${leadId}:`, err);
        sendResults.push({ leadId, status: "failed" });
      }
    }

    const successCount = sendResults.filter((r) => r.status === "sent").length;

    console.log(
      `[DEPLOY] Batch ${batchId} deployed. ` +
      `Sent: ${successCount}/${deployableLeads.length}. ` +
      `Deferred: ${deferredLeads.length} (throttle cap).`
    );

    return NextResponse.json({
      success: true,
      governance: "cleared",
      deployment: {
        batchId,
        inboxId,
        senderEmail: inbox.emailAddress,
        totalQueued: leadIds.length,
        deployed: successCount,
        deferred: deferredLeads.length,
        deferredLeadIds: deferredLeads,
        throttleStatus: {
          sentToday: throttleCheck.sentToday + successCount,
          dailyLimit: throttleCheck.dailyLimit,
          remaining: throttleCheck.remaining - successCount,
        },
      },
      message:
        deferredLeads.length > 0
          ? `${successCount} leads deployed. ${deferredLeads.length} deferred to tomorrow (throttle cap reached).`
          : `${successCount} leads deployed successfully.`,
    });
  } catch (error) {
    console.error("[DEPLOY PREFLIGHT] Catastrophic failure:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Deployment pre-flight check failed. No emails were sent.",
      },
      { status: 500 }
    );
  }
}
