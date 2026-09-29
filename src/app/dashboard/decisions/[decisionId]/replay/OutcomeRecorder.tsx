'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import FrameSelect from '@/components/ui/FrameSelect';

const TYPES = ['MEETING_BOOKED', 'OPPORTUNITY_ADVANCED', 'WON', 'LOST',
  'NOT_INTERESTED', 'BAD_FIT', 'NO_RESPONSE', 'OTHER'] as const;
const field = 'w-full rounded border border-gray-700 bg-[#0d0d0d] px-3 py-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF5A1F]';
export default function OutcomeRecorder({ decisionId, hasCurrent }: { decisionId: string; hasCurrent: boolean }) {
  const router = useRouter();
  const [outcomeType, setOutcomeType] = useState<(typeof TYPES)[number]>('MEETING_BOOKED');
  const [occurredAt, setOccurredAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    if (!occurredAt || busy) return;
    setBusy(true); setMessage('');
    try {
      const at = new Date(occurredAt);
      if (!Number.isFinite(at.getTime())) throw new Error('Choose a valid occurrence time.');
      const response = await fetch('/api/outcome-learning/outcomes', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decisionId, outcomeType,
          occurredAt: at.toISOString(), note: note.trim() || null, idempotencyKey: crypto.randomUUID() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Outcome could not be saved.');
      setMessage('Business outcome recorded.'); setNote(''); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Outcome could not be saved.'); }
    finally { setBusy(false); }
  }
  return <div className="mt-4 border-t border-gray-800 pt-4">
    <h3 className="mb-3 font-medium text-white">{hasCurrent ? 'Correct recorded outcome' : 'Record business outcome'}</h3>
    <p className="mb-3 text-xs text-gray-400">Human-reported business fact. A send or approval does not automatically count as success. Corrections keep prior revisions.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label>Outcome<FrameSelect className="mt-1" ariaLabel="Outcome" value={outcomeType}
        onValueChange={value => setOutcomeType(value as (typeof TYPES)[number])}
        options={TYPES.map(type => ({ value: type, label: type.replaceAll('_', ' ') }))} /></label>
      <label>Occurred at<input className={`${field} mt-1`} type="datetime-local" required value={occurredAt}
        onChange={event => setOccurredAt(event.target.value)} /></label>
    </div>
    <label className="mt-3 block">Note (optional)<textarea className={`${field} mt-1`} maxLength={500}
      value={note} onChange={event => setNote(event.target.value)} rows={2} /></label>
    <button type="button" disabled={busy || !occurredAt} onClick={() => void save()}
      className="mt-3 rounded bg-[#FF5A1F] px-4 py-2 font-medium text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
      {busy ? 'Saving…' : hasCurrent ? 'Record correction' : 'Record outcome'}</button>
    {message && <p role="status" className="mt-2 text-xs text-gray-300">{message}</p>}
  </div>;
}
