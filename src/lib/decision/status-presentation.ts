export type DecisionStatusPresentation = { label: string; tone: string; badgeTone: string };

/** Shared Inbox Triage status labels and semantic colors. */
export function decisionStatusPresentation(status: string | null | undefined): DecisionStatusPresentation {
  switch (status) {
    case 'READY':
      return { label: 'Ready', tone: 'text-emerald-300',
        badgeTone: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' };
    case 'NEEDS_REVIEW':
      return { label: 'Needs review', tone: 'text-amber-300',
        badgeTone: 'border-amber-400/20 bg-amber-400/10 text-amber-300' };
    case 'FAILED':
      return { label: 'Failed', tone: 'text-red-300',
        badgeTone: 'border-red-400/20 bg-red-400/10 text-red-300' };
    case 'PENDING':
      return { label: 'Pending', tone: 'text-white/45',
        badgeTone: 'border-white/[0.12] bg-white/[0.03] text-white/65' };
    default:
      return { label: status?.replaceAll('_', ' ') || 'Unresolved', tone: 'text-white/45',
        badgeTone: 'border-white/[0.12] bg-white/[0.03] text-white/65' };
  }
}
