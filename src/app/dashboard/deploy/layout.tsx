import { redirect } from "next/navigation";
import { verifiedCustomerUser } from '@/lib/customer-session';

export const dynamic = "force-dynamic";

export default async function DeployAccessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await verifiedCustomerUser();
  if (!user) {
    redirect("/login");
  }

  return <>{children}</>;
}
