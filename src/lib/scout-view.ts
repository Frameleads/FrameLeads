import type { ProspectResearchStatus } from '@prisma/client';

export type ScoutStatus = ProspectResearchStatus | 'NOT_RESEARCHED';

export function scoutStatus(status: ScoutStatus) {
  switch (status) {
    case 'RESEARCHING': return { label: 'Researching', tone: 'border-sky-400/20 bg-sky-400/10 text-sky-300', busy: true };
    case 'READY': return { label: 'Researched', tone: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300', busy: false };
    case 'NEEDS_REVIEW': return { label: 'Needs review', tone: 'border-amber-400/20 bg-amber-400/10 text-amber-300', busy: false };
    case 'FAILED': return { label: 'Research failed', tone: 'border-red-400/20 bg-red-400/10 text-red-300', busy: false };
    default: return { label: 'Not researched', tone: 'border-border/70 bg-muted/40 text-muted-foreground', busy: false };
  }
}

export function researchStatusDetail(status: ScoutStatus, qualification: string) {
  if (status === 'NOT_RESEARCHED') return qualification === 'QUALIFIED'
    ? 'Run research to generate fit and evidence' : 'Qualify first to enable evidence-based research';
  if (status === 'RESEARCHING') return 'Research is in progress';
  if (status === 'NEEDS_REVIEW') return 'Some research evidence needs review';
  if (status === 'FAILED') return 'Retry research to generate evidence';
  return '';
}

export function scoutPrimaryAction(status: ScoutStatus): 'research' | 'view' | 'retry' | 'busy' {
  if (status === 'RESEARCHING') return 'busy';
  if (status === 'FAILED') return 'retry';
  if (status === 'READY' || status === 'NEEDS_REVIEW') return 'view';
  return 'research';
}

export function qualificationStatus(status: string, reasonCode: string, override: string, policyVersion = 1) {
  if (override === 'USER_QUALIFIED') return { label: 'Qualified - your decision', tone: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300', detail: '' };
  if (override === 'USER_EXCLUDED') return { label: 'Excluded - your decision', tone: 'border-red-400/20 bg-red-400/10 text-red-300', detail: '' };
  if (policyVersion < 1) return { label: 'Needs review', tone: 'border-amber-400/20 bg-amber-400/10 text-amber-300', detail: 'Requalification required' };
  if (status === 'REJECTED') return { label: 'Not qualified', tone: 'border-red-400/20 bg-red-400/10 text-red-300', detail: reasonCode === 'EXCLUDED' ? 'Excluded by ICP rule' : 'Rejected by ICP policy' };
  if (status === 'NEEDS_REVIEW') {
    const detail = reasonCode === 'NO_RULES' || reasonCode === 'INACTIVE' ? 'ICP profile needs setup' :
      reasonCode === 'MISSING_DATA' || reasonCode === 'AMBIGUOUS' ? 'More prospect information needed' : 'Review qualification';
    return { label: 'Needs review', tone: 'border-amber-400/20 bg-amber-400/10 text-amber-300', detail };
  }
  if (status === 'QUALIFIED') return { label: 'Qualified', tone: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300', detail: '' };
  return { label: 'Not assessed', tone: 'border-border/70 bg-muted/40 text-muted-foreground', detail: 'Run qualification to check ICP fit' };
}

export function fitSummary(score: number | null, tier: string | null, status: ScoutStatus) {
  if (typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= 100) return { label: `${score}/100`, tone: tier === 'STRONG' ? 'text-emerald-300' : tier === 'WEAK' || tier === 'DISQUALIFIED' ? 'text-red-300' : 'text-amber-300', detail: tier ? `${tier.toLowerCase()} fit` : 'Assessed' };
  return { label: status === 'FAILED' ? 'Unavailable' : 'Not assessed yet', tone: 'text-muted-foreground', detail: '' };
}

export function valueSummary(value: string | null, qualification: string, status: ScoutStatus) {
  if (value) return value;
  if (status === 'FAILED') return 'Unavailable';
  return qualification === 'QUALIFIED' ? 'Awaiting research' : 'Awaiting qualification';
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
