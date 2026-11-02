export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifiedCustomerUser } from '@/lib/customer-session';
import { requireFeatureAccess } from "@/lib/auth-guard";

async function getCurrentUserId() {
  return (await verifiedCustomerUser())?.id || null;
}

async function getOwnedSignal(id: string, userId: string) {
  return prisma.inboundSignal.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  });
}

export async function POST(request: Request) {
  try {
    const authError = await requireFeatureAccess('INBOX_TRIAGE');
    if (authError) return authError;

    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const payload = await request.json().catch(() => null);
    const id = typeof payload?.id === "string" ? payload.id.trim() : "";
    if (!id) {
      return NextResponse.json({ success: false, error: "Signal ID is required." }, { status: 400 });
    }

    const signal = await getOwnedSignal(id, userId);
    if (!signal) {
      return NextResponse.json({ success: false, error: "Signal not found." }, { status: 404 });
    }

    await prisma.inboundSignal.update({
      where: { id },
      data: { status: "ARCHIVED" },
    });

    return NextResponse.json({ success: true, status: "ARCHIVED" });
  } catch (error) {
    console.error("[TRIAGE ARCHIVE ERROR]:", error);
    return NextResponse.json(
      { success: false, error: "Unable to archive this signal." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const authError = await requireFeatureAccess('INBOX_TRIAGE');
    if (authError) return authError;

    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }
    const payload = await request.json().catch(() => null);
    const id = typeof payload?.id === "string" ? payload.id.trim() : "";
    if (!id) {
      return NextResponse.json({ success: false, error: "Signal ID is required." }, { status: 400 });
    }

    const signal = await getOwnedSignal(id, userId);
    if (!signal) {
      return NextResponse.json({ success: false, error: "Signal not found." }, { status: 404 });
    }
    if (!['PENDING', 'ARCHIVED'].includes(signal.status)) {
      return NextResponse.json(
        { success: false, error: "Only active or archived signals can be moved to trash." },
        { status: 409 },
      );
    }

    // Soft remove from the working queues. The original signal and its
    // decision history remain stored with status TRASHED.
    await prisma.inboundSignal.update({
      where: { id },
      data: { status: "TRASHED" },
    });
    return NextResponse.json({ success: true, status: "TRASHED", softRemoved: true });
  } catch (error) {
    console.error("[TRIAGE TRASH ERROR]:", error);
    return NextResponse.json(
      { success: false, error: "Unable to move this signal to trash." },
      { status: 500 },
    );
  }
}
