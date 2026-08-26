import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

interface ListRouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: ListRouteContext) {
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
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ success: false, error: "List name is required." }, { status: 400 });
    }

    const list = await prisma.leadList.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!list) {
      return NextResponse.json({ success: false, error: "List not found." }, { status: 404 });
    }

    const updatedList = await prisma.leadList.update({
      where: { id: list.id },
      data: { name },
      include: { _count: { select: { leads: true } } },
    });

    return NextResponse.json({ success: true, list: updatedList });
  } catch (error) {
    console.error("Failed to rename lead list:", error);
    return NextResponse.json({ success: false, error: "Failed to rename list." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: ListRouteContext) {
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
    const list = await prisma.leadList.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!list) {
      return NextResponse.json({ success: false, error: "List not found." }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.generatedLead.updateMany({
        where: { userId: user.id, listId: list.id },
        data: { listId: null },
      }),
      prisma.leadList.delete({ where: { id: list.id } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete lead list:", error);
    return NextResponse.json({ success: false, error: "Failed to delete list." }, { status: 500 });
  }
}
