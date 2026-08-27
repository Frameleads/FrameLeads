export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEnterpriseTier } from "@/lib/auth-guard";

async function getCurrentUserId() {
  const cookieStore = await cookies();
  const email = cookieStore.get("user_email")?.value;
  if (!email) return null;

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  });
  return user?.id || null;
}

async function getOwnedSignal(id: string, userId: string) {
  return prisma.inboundSignal.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  });
}

export async function POST(request: Request) {
  try {
    const authError = await requireEnterpriseTier();
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
    const authError = await requireEnterpriseTier();
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
    if (signal.status !== "ARCHIVED") {
      return NextResponse.json(
        { success: false, error: "Only archived signals can be permanently deleted." },
        { status: 409 },
      );
    }

    await prisma.inboundSignal.update({
      where: { id },
      data: { status: "TRASHED" },
    });
    return NextResponse.json({ success: true, status: "TRASHED" });
  } catch (error) {
    console.error("[TRIAGE TRASH ERROR]:", error);
    return NextResponse.json(
      { success: false, error: "Unable to permanently delete this signal." },
      { status: 500 },
    );
  }
}
