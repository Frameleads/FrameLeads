import { cookies } from "next/headers";
import SandboxClient from "./SandboxClient";

export default async function SandboxPage() {
  const cookieStore = await cookies();
  const tier = cookieStore.get('tier')?.value || 'CORE';

  return <SandboxClient userTier={tier} />;
}
