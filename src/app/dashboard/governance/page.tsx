import GovernanceDashboard from "./GovernanceDashboard";
import { cookies } from "next/headers";

export default async function GovernancePage() {
  const cookieStore = await cookies();
  const tier = cookieStore.get("tier")?.value || "CORE";
  return <GovernanceDashboard userTier={tier} />;
}
