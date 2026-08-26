import { NextResponse } from "next/server";
import { cookies } from "next/headers";
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

    const lead = await prisma.generatedLead.findFirst({
      where: {
        id,
        userId: user.id,
      },
      select: { id: true },
    });

    if (!lead) {
      return NextResponse.json({ success: false, error: "Lead not found." }, { status: 404 });
    }

    await prisma.generatedLead.delete({
      where: { id: lead.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete generated lead:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete the lead." },
      { status: 500 }
    );
  }
}
