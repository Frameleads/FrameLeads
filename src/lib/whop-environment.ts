/** Whop Sandbox credentials and API requests must never be used in production. */
export function isWhopSandbox(): boolean {
  const flag = process.env.WHOP_SANDBOX;
  if (flag !== undefined && flag !== "true" && flag !== "false") {
    throw new Error("Invalid WHOP_SANDBOX flag.");
  }
  if (flag !== "true") return false;
  const preview = process.env.VERCEL_ENV === "preview";
  const localDev = !process.env.VERCEL_ENV && process.env.NODE_ENV === "development";
  if (!preview && !localDev) {
    throw new Error("Whop Sandbox requires isolated Preview or local development.");
  }
  return true;
}
export function getWhopApiOrigin(): string {
  return isWhopSandbox() ? "https://sandbox-api.whop.com" : "https://api.whop.com";
}
