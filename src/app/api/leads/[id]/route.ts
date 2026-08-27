import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

interface LeadRouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, { params }: LeadRouteContext) {
  try {
    const cookieStore = await cookies();
    const email = cookieStore.get("user_email")?.value;
    const user = email
      ? await prisma.user.findUnique({
          where: { email: email.trim().toLowerCase() },
          select: { id: true },
        })
      : null;

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id?.trim()) {
      return NextResponse.json({ success: false, error: "Lead ID is required." }, { status: 400 });
    }

    const deletedLead = await prisma.$transaction(async (transaction) => {
      const lead = await transaction.generatedLead.findFirst({
        where: {
          id,
          userId: user.id,
        },
        select: { id: true },
      });

      if (!lead) return null;

      await transaction.outboundLog.deleteMany({
        where: { leadId: lead.id },
      });

      return transaction.generatedLead.delete({
        where: { id: lead.id },
        select: { id: true },
      });
    });

    if (!deletedLead) {
      return NextResponse.json({ success: false, error: "Lead not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, deletedLeadId: deletedLead.id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ success: false, error: "Lead not found." }, { status: 404 });
    }

    console.error("[LEAD DELETE ERROR]:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete the lead." },
      { status: 500 }
    );
  }
}
