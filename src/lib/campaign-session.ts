export const CAMPAIGN_SESSION_KEY = 'frameleads:campaign_context';
const LEGACY_CAMPAIGN_KEY = 'campaign_context';

export type CampaignContext = Record<string, unknown>;

function removeLegacyCampaignValue() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(LEGACY_CAMPAIGN_KEY);
}

export function readCampaignContext(): CampaignContext | null {
  if (typeof window === 'undefined') return null;
  removeLegacyCampaignValue();
  const stored = window.sessionStorage.getItem(CAMPAIGN_SESSION_KEY);
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as CampaignContext : null;
  } catch {
    window.sessionStorage.removeItem(CAMPAIGN_SESSION_KEY);
    return null;
  }
}

export function writeCampaignContext(context: CampaignContext) {
  if (typeof window === 'undefined') return;
  removeLegacyCampaignValue();
  window.sessionStorage.setItem(CAMPAIGN_SESSION_KEY, JSON.stringify(context));
}

export function clearCampaignContext() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(CAMPAIGN_SESSION_KEY);
  removeLegacyCampaignValue();
}
