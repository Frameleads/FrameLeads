import { cookies } from "next/headers";
import SandboxClient from "./SandboxClient";

export default function SandboxPage() {
  const cookieStore = cookies();
  const tier = cookieStore.get('tier')?.value || 'CORE';

  return <SandboxClient userTier={tier} />;
}
