import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifiedCustomerUser } from '@/lib/customer-session';

export async function DELETE() {
  try {
    const user = await verifiedCustomerUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const result = await prisma.generatedLead.deleteMany({
      where: { userId: user.id },
    });

    return NextResponse.json({ success: true, deletedCount: result.count });
  } catch (error) {
    console.error("Failed to clear generated leads:", error);
    return NextResponse.json(
      { success: false, error: "Failed to clear the Sandbox." },
      { status: 500 }
    );
  }
}
