/**
 * Semantic presentation for verified inbound intent signals.
 * Presentation only: does not classify prospects or modify decision outcomes.
 */
export type SignalChipTone = 'meeting' | 'interest' | 'question' | 'commercial' | 'risk' | 'neutral';

export const SIGNAL_CHIP_STYLES: Record<SignalChipTone, string> = {
  meeting: 'border-amber-300/25 bg-amber-400/10 text-amber-200',
  interest: 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200',
  question: 'border-sky-300/25 bg-sky-400/10 text-sky-200',
  commercial: 'border-orange-300/25 bg-orange-400/10 text-orange-200',
  risk: 'border-rose-300/25 bg-rose-400/10 text-rose-200',
  neutral: 'border-white/10 bg-white/[0.06] text-white/70',
};

export function getSignalChipTone(label: string): SignalChipTone {
  const normalized = label.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (/meeting|demo|call request|booked|booking|schedul|appointment/.test(normalized)) return 'meeting';
  if (/negotiat|pric(e|ing)|discount|commercial|contract|objection|fee waiver|cancellation|payment terms/.test(normalized)) return 'commercial';
  if (/risk|delay|not interested|negative|concern|timing objection|low intent|ooto|bounced/.test(normalized)) return 'risk';
  if (/positive interest|interested|warm interest|buying signal|ready to (buy|move)|strong interest/.test(normalized)) return 'interest';
  if (/question|clarif|information request|info request|requesting resources|how (does|would)|details/.test(normalized)) return 'question';
  return 'neutral';
}

export function getSignalChipStyle(label: string): string {
  return SIGNAL_CHIP_STYLES[getSignalChipTone(label)];
}
