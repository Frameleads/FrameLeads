import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

interface MoveLeadRouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: MoveLeadRouteContext) {
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
    const body = await request.json().catch(() => null);
    const listId = typeof body?.listId === "string" && body.listId.trim() ? body.listId.trim() : null;

    const lead = await prisma.generatedLead.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!lead) {
      return NextResponse.json({ success: false, error: "Lead not found." }, { status: 404 });
    }

    if (listId) {
      const list = await prisma.leadList.findFirst({
        where: { id: listId, userId: user.id },
        select: { id: true },
      });
      if (!list) {
        return NextResponse.json({ success: false, error: "List not found." }, { status: 404 });
      }
    }

    const updatedLead = await prisma.generatedLead.update({
      where: { id: lead.id },
      data: { listId },
      select: { id: true, listId: true },
    });

    return NextResponse.json({ success: true, lead: updatedLead });
  } catch (error) {
    console.error("Failed to move generated lead:", error);
    return NextResponse.json({ success: false, error: "Failed to move lead." }, { status: 500 });
  }
}
