'use client';

import { useCallback, useEffect, useState } from 'react';

type Coverage = { dateFrom: string; dateTo: string; eligibleCount: number; truncated: boolean;
  observedCount: number; observedSuccessCount: number; comparisonCount: number;
  comparisonSuccessCount: number; observedRate: number | null; comparisonRate: number | null;
  sufficient: boolean; material: boolean };
type Suggestion = { id: string; title: string; explanation: string; sampleSize: number;
  observedCount: number; observedSuccessCount: number; comparisonCount: number;
  comparisonSuccessCount: number; observedRate: number; comparisonRate: number;
  dateFrom: string; dateTo: string; targetSubsystem: string;
  evidenceSnapshot: { caveat?: string } };
const card = 'rounded-lg border border-gray-800 bg-[#121212] p-5';
const button = 'rounded border border-[#FF5A1F] px-3 py-2 text-xs font-semibold text-[#FF5A1F] hover:bg-[#FF5A1F]/10 disabled:opacity-40 focus-visible:outline';

export default function OutcomeLearningClient() {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const load = useCallback(async () => {
    const response = await fetch('/api/outcome-learning', { cache: 'no-store' });
    if (!response.ok) throw new Error('Outcome learning could not load.');
    const data = await response.json();
    setCoverage(data.coverage); setSuggestions(data.suggestions);
  }, []);
  useEffect(() => { void load().catch(error => setError(error.message)); }, [load]);
  async function refresh() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/outcome-learning', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Refresh failed.');
      setNotice(data.suggestion ? 'Observed pattern refreshed for review.' :
        data.reason === 'BOUNDED_SAMPLE_LIMIT' ? 'Sample exceeds the bounded V1 limit; no suggestion was created.' :
          'No suggestion met the evidence and rate-gap thresholds.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Refresh failed.'); }
    finally { setBusy(false); }
  }
  async function review(id: string, status: 'ACCEPTED_FOR_REVIEW' | 'REJECTED') {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/outcome-learning/suggestions/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note: reviewNote.trim() || null }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Review failed.');
      setNotice(status === 'ACCEPTED_FOR_REVIEW' ? 'Accepted for human review; no policy changed.' : 'Suggestion rejected.');
      setReviewNote(''); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review failed.'); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-4xl space-y-5 px-4 py-8 text-sm text-gray-300 sm:px-8">
    <header><h1 className="text-2xl font-semibold text-white">Outcome Learning</h1>
      <p className="mt-2 text-gray-400">Human-recorded business outcomes can reveal associations for review. Suggestions never change policy automatically.</p></header>
    <section className={card}><div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Outcome coverage</h2>
      <button type="button" className={button} disabled={busy} onClick={() => void refresh()}>{busy ? 'Working…' : 'Refresh learnings'}</button></div>
      {coverage ? <><p className="mt-3">{coverage.eligibleCount} Decisions with current recorded outcomes in the last 90 days.</p>
        <p className="mt-1 text-xs text-gray-400">{new Date(coverage.dateFrom).toLocaleDateString()} – {new Date(coverage.dateTo).toLocaleDateString()} · Minimum: 10 outcomes overall and 5 in each compared group.</p>
        <p className="mt-2">Evidence threshold: {coverage.sufficient ? 'Met' : 'Not met'}{coverage.truncated ? ' · Bounded sample limit reached' : ''}</p>
        <p className="mt-2 text-xs text-gray-500">Positive outcome types: meeting booked, opportunity advanced, or won. Sends and approvals alone are excluded.</p></> : <p role="status" className="mt-3">Loading outcome coverage…</p>}
      {notice && <p role="status" className="mt-3 text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-red-300">{error}</p>}
    </section>
    <section className={card}><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Open learning suggestions</h2>
      {!suggestions.length && <p>No open suggestion has enough evidence yet.</p>}
      {suggestions.map(row => <article key={row.id} className="mb-4 border-t border-gray-800 pt-4">
        <h3 className="font-medium text-white">{row.title}</h3><p className="mt-2">{row.explanation}</p>
        <p className="mt-2 text-xs text-gray-400">Sample: {row.sampleSize} · Breached: {row.observedSuccessCount}/{row.observedCount} ({row.observedRate}%) · No recorded breach: {row.comparisonSuccessCount}/{row.comparisonCount} ({row.comparisonRate}%)</p>
        <p className="mt-1 text-xs text-gray-400">{new Date(row.dateFrom).toLocaleDateString()} – {new Date(row.dateTo).toLocaleDateString()} · Target: {row.targetSubsystem.replaceAll('_', ' ')}</p>
        <p className="mt-2 text-xs text-amber-300">{row.evidenceSnapshot.caveat ?? 'Observed association only; not a causal claim.'}</p>
        <label className="mt-3 block text-xs">Review note (optional)<input className="mt-1 w-full rounded border border-gray-700 bg-[#0d0d0d] px-3 py-2 text-white focus-visible:outline" maxLength={500} value={reviewNote} onChange={event => setReviewNote(event.target.value)} /></label>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} disabled={busy}
          onClick={() => void review(row.id, 'ACCEPTED_FOR_REVIEW')}>Accept for review</button>
          <button type="button" className={button} disabled={busy} onClick={() => void review(row.id, 'REJECTED')}>Reject</button></div>
      </article>)}
    </section>
  </main>;
}
