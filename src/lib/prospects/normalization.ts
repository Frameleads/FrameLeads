import { createHash } from 'node:crypto';
import type { ProspectMetadata } from './metadata';

export function cleanText(value?: string | null): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

export function normalizeEmail(value?: string | null): string | null {
  const email = cleanText(value)?.toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function parseWebUrl(value?: string | null): URL | null {
  const text = cleanText(value);
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}

export function normalizeLinkedInUrl(value?: string | null): string | null {
  const url = parseWebUrl(value);
  if (!url || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase())) return null;
  const path = url.pathname.replace(/\/+$/, '');
  // Only actual personal profiles; reject company URLs and legacy missing-url placeholders.
  if (!/^\/in\/[^/]+$/.test(path)) return null;
  return `https://linkedin.com${path}`;
}

export function normalizePersonName(value?: string | null): string | null {
  return cleanText(value)?.normalize('NFC').toLowerCase()
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u2010\u2011]/g, '-')
    .replace(/\s+/g, ' ') || null;
}

export const normalizeCompanyName = normalizePersonName;

export function normalizeWebsiteDomain(value?: string | null): string | null {
  const url = parseWebUrl(value);
  const host = url?.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return host && host.includes('.') ? host : null;
}

export type IdentityInput = {
  userId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  linkedInUrl?: string | null;
  companyName?: string | null;
  websiteUrl?: string | null;
} & Partial<ProspectMetadata>;

export function buildFallbackIdentityKey(input: Omit<IdentityInput, 'userId'>): string | null {
  const first = normalizePersonName(input.firstName);
  const last = normalizePersonName(input.lastName);
  const name = [first, last].filter(Boolean).join(' ');
  const company = normalizeCompanyName(input.companyName);
  const domain = normalizeWebsiteDomain(input.websiteUrl);
  // A single given name or generated placeholder is insufficient fallback evidence.
  if (!first || !last || /^(unknown|unknown prospect|n\/a|null)$/.test(name) || first === 'unknown') return null;
  if (!domain && (!company || /^(unknown|unknown company|n\/a|null)$/.test(company))) return null;
  return 'v1:' + createHash('sha256').update(JSON.stringify([name, domain ? 'domain' : 'company', domain || company])).digest('hex');
}
