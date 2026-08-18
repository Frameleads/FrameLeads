import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import EnterprisePaywall from "@/components/EnterprisePaywall";

export const dynamic = "force-dynamic";

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

  if (!user) {
    redirect("/login");
  }

  return (
    <EnterprisePaywall userTier={user.tier} featureName="Deploy feature">
      {children}
    </EnterprisePaywall>
  );
}
