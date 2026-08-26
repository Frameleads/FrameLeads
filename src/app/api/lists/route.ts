import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

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

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const lists = await prisma.leadList.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { leads: true } } },
    });

    return NextResponse.json({ success: true, lists });
  } catch (error) {
    console.error("Failed to fetch lead lists:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch lists." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ success: false, error: "List name is required." }, { status: 400 });
    }

    const list = await prisma.leadList.create({
      data: { name, userId },
      include: { _count: { select: { leads: true } } },
    });

    return NextResponse.json({ success: true, list }, { status: 201 });
  } catch (error) {
    console.error("Failed to create lead list:", error);
    return NextResponse.json({ success: false, error: "Failed to create list." }, { status: 500 });
  }
}
