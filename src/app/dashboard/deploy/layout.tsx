import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DEPLOY_TIERS = new Set(["CORE", "ENTERPRISE"]);

export default async function DeployAccessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const session = cookieStore.get("frameleads_session")?.value;
  const email = cookieStore.get("user_email")?.value;

  if (!session || !email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { tier: true },
  });

  if (!user || !DEPLOY_TIERS.has(user.tier)) {
    redirect("/dashboard/ingestion?error=deploy_requires_core");
  }

  return children;
}
