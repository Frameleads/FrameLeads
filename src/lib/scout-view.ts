import type { ProspectResearchStatus } from '@prisma/client';

export type ScoutStatus = ProspectResearchStatus | 'NOT_RESEARCHED';

export function scoutStatus(status: ScoutStatus) {
  switch (status) {
    case 'RESEARCHING': return { label: 'Researching', tone: 'border-sky-400/20 bg-sky-400/10 text-sky-300', busy: true };
    case 'READY': return { label: 'Ready', tone: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300', busy: false };
    case 'NEEDS_REVIEW': return { label: 'Needs review', tone: 'border-amber-400/20 bg-amber-400/10 text-amber-300', busy: false };
    case 'FAILED': return { label: 'Research failed', tone: 'border-red-400/20 bg-red-400/10 text-red-300', busy: false };
    default: return { label: 'Not researched', tone: 'border-border/70 bg-muted/40 text-muted-foreground', busy: false };
  }
}

export function scoutPrimaryAction(status: ScoutStatus): 'research' | 'view' | 'retry' | 'busy' {
  if (status === 'RESEARCHING') return 'busy';
  if (status === 'FAILED') return 'retry';
  if (status === 'READY' || status === 'NEEDS_REVIEW') return 'view';
  return 'research';
}

export const whyNowSummary = (whyNow: string | null | undefined) => whyNow?.trim() || 'No verified timing signal';

export function scoutHandoffEligible(
  qualification: { status: string; override: string; policyVersion: number } | null,
  researchStatus: ScoutStatus,
): boolean {
  return Boolean(qualification && qualification.status === 'QUALIFIED' &&
    qualification.override !== 'USER_EXCLUDED' &&
    (qualification.override === 'USER_QUALIFIED' || qualification.policyVersion >= 1) &&
    researchStatus === 'READY');
}

export function qualificationLabel(status: string, reasonCode: string, override: string, policyVersion = 1) {
  if (override === 'USER_QUALIFIED') return 'Qualified — Your decision';
  if (override === 'USER_EXCLUDED') return 'Excluded — Your decision';
  if (policyVersion < 1) return 'Needs Review — Requalification required';
  if (status === 'REJECTED') return reasonCode === 'EXCLUDED' ? 'Excluded — ICP rule' : 'Excluded — ICP policy';
  if (status === 'NEEDS_REVIEW') return reasonCode === 'TARGET_MISMATCH' ? 'Needs Review — ICP mismatch' : 'Needs Review — More information required';
  if (status === 'QUALIFIED') return 'Qualified';
  return 'Not assessed';
}

export function safeEvidenceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}
