import type { FrameLeadsTier } from './entitlements';

/** Effective tier override for authenticated requests in normal local development. */
export function localDevelopmentTierFor(host: string | null, nodeEnv: string | undefined): FrameLeadsTier | null {
  if (nodeEnv === 'production') return null;
  const hostname = host?.startsWith('[') ? host.slice(1).split(']')[0] : host?.split(':')[0];
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' ? 'ENTERPRISE' : null;
}
