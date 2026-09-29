'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, CalendarDays, CheckCircle2, Layers3, Lightbulb, RefreshCw } from 'lucide-react';

type Coverage = { dateFrom: string; dateTo: string; eligibleCount: number; truncated: boolean;
  observedCount: number; observedSuccessCount: number; comparisonCount: number;
  comparisonSuccessCount: number; observedRate: number | null; comparisonRate: number | null;
  sufficient: boolean; material: boolean };
type Suggestion = { id: string; title: string; explanation: string; sampleSize: number;
  observedCount: number; observedSuccessCount: number; comparisonCount: number;
  comparisonSuccessCount: number; observedRate: number; comparisonRate: number;
  dateFrom: string; dateTo: string; targetSubsystem: string;
  evidenceSnapshot: { caveat?: string } };
const card = 'rounded-xl border border-gray-800 bg-[#111111] p-5 sm:p-6';
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
  const progress = coverage ? Math.min(100, Math.max(0, coverage.eligibleCount / 10 * 100)) : 0;
  return <main className="mx-auto w-full max-w-[1680px] space-y-5 py-6 text-sm text-gray-300">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#FF5A1F]">Decision intelligence</p><h1 className="mt-2 text-2xl font-semibold text-white">Outcome Learning</h1>
      <p className="mt-1 max-w-3xl text-gray-400">Human-recorded outcomes surface associations for review. Suggestions never change policy automatically.</p></div>
      <button type="button" className={button} disabled={busy} onClick={() => void refresh()}><RefreshCw className="mr-2 inline h-3.5 w-3.5" aria-hidden="true" />{busy ? 'Working…' : 'Refresh learnings'}</button></header>
    <section aria-label="Outcome learning status">
      <div className="grid grid-cols-1 gap-3 min-[375px]:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<Activity />} label="Eligible outcomes" value={coverage ? `${coverage.eligibleCount} / 10` : 'Loading'} detail={coverage?.truncated ? 'Bounded sample limit reached' : 'Evidence threshold'} />
        <Metric icon={<CheckCircle2 />} label="Evidence status" value={coverage ? (coverage.sufficient ? 'Threshold met' : 'Building') : 'Loading'} detail={coverage ? `${coverage.observedCount + coverage.comparisonCount} observed records` : 'Current coverage'} />
        <Metric icon={<CalendarDays />} label="Learning window" value={coverage ? '90 days' : '—'} detail={coverage ? `${new Date(coverage.dateFrom).toLocaleDateString()} – ${new Date(coverage.dateTo).toLocaleDateString()}` : 'Date range'} />
        <Metric icon={<Lightbulb />} label="Open suggestions" value={coverage ? String(suggestions.length) : 'Loading'} detail="Human review queue" />
      </div>
    </section>
    <section className="grid gap-4 xl:grid-cols-12">
      <article className={`${card} xl:col-span-7`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-white">Learning readiness</h2><p className="mt-1 text-xs text-gray-400">Evidence must meet the existing minimum before an association can be suggested.</p></div><Layers3 className="h-5 w-5 text-[#FF5A1F]" aria-hidden="true" /></div>
        {coverage ? <><div className="mt-5 flex flex-col items-start gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"><p className="text-lg font-semibold text-white">{coverage.eligibleCount} <span className="text-sm font-normal text-gray-400">/ 10 eligible outcomes</span></p><p className="text-xs text-gray-500">{coverage.sufficient ? 'Threshold met' : `${Math.max(0, 10 - coverage.eligibleCount)} more to minimum`}</p></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Eligible outcomes toward learning threshold" aria-valuemin={0} aria-valuemax={10} aria-valuenow={Math.min(10, coverage.eligibleCount)}><div className="h-full rounded-full bg-[#FF5A1F] transition-[width] duration-200" style={{ width: `${progress}%` }} /></div>
          <p className="mt-4 text-xs text-gray-500">{coverage.observedCount} observed group · {coverage.comparisonCount} comparison group{coverage.truncated ? ' · Bounded sample limit reached' : ''}</p></> : <p role="status" className="mt-5 text-sm text-gray-400">Loading outcome coverage…</p>}
        {notice && <p role="status" className="mt-4 text-emerald-300">{notice}</p>}{error && <p role="alert" className="mt-4 text-red-300">{error}</p>}
      </article>
      <article className={`${card} xl:col-span-5`}><h2 className="text-sm font-semibold text-white">Evidence threshold</h2><p className="mt-1 text-xs text-gray-400">What counts toward a reviewable observation</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"><div className="rounded-lg border border-gray-800 bg-black/20 p-3"><p className="text-xs uppercase tracking-wide text-gray-500">Minimum evidence</p><p className="mt-1 font-medium text-white">10 overall · 5 per group</p></div><div className="rounded-lg border border-gray-800 bg-black/20 p-3"><p className="text-xs uppercase tracking-wide text-gray-500">Positive outcomes</p><p className="mt-1 text-xs leading-5 text-gray-300">Meeting booked, opportunity advanced, or won.</p></div></div>
        <p className="mt-3 text-xs leading-5 text-gray-500">Sends and approvals alone are excluded. FrameLeads surfaces observed patterns for human review and never silently changes policy.</p>
      </article>
    </section>
    <section className={card}><div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-800 pb-4"><div><h2 className="text-sm font-semibold text-white">Open learning suggestions</h2><p className="mt-1 text-xs text-gray-400">Evidence and comparisons remain visible for human review.</p></div>{coverage && <span className="rounded-full border border-gray-700 px-2.5 py-1 text-xs text-gray-400">{suggestions.length} open</span>}</div>
      {!suggestions.length && <div className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#FF5A1F]/30 bg-[#FF5A1F]/10 text-[#FF5A1F]"><Lightbulb className="h-5 w-5" aria-hidden="true" /></div><div><p className="font-medium text-white">No suggestion is ready for review</p><p className="mt-1 max-w-3xl text-xs leading-5 text-gray-400">Current coverage and the evidence threshold above show what is available. As eligible outcomes accumulate, FrameLeads will surface observed associations here. Policy remains unchanged until a person reviews a suggestion.</p></div></div>}
      <div className="space-y-3 pt-4">{suggestions.map(row => { const observed = Math.min(100, Math.max(0, row.observedRate)); const comparison = Math.min(100, Math.max(0, row.comparisonRate)); return <article key={row.id} className="grid min-w-0 gap-4 rounded-lg border border-gray-800 bg-black/20 p-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-[#FF5A1F]">Observation · {row.targetSubsystem.replaceAll('_', ' ')}</p><h3 className="mt-1 font-medium text-white">{row.title}</h3><p className="mt-2 text-xs leading-5 text-gray-400">{row.explanation}</p><p className="mt-2 text-[11px] text-gray-500">{new Date(row.dateFrom).toLocaleDateString()} – {new Date(row.dateTo).toLocaleDateString()} · n={row.sampleSize}</p></div>
        <div className="space-y-3 xl:col-span-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Comparative evidence</p><Rate label="Observed group" successes={row.observedSuccessCount} count={row.observedCount} rate={row.observedRate} width={observed} /><Rate label="Comparison group" successes={row.comparisonSuccessCount} count={row.comparisonCount} rate={row.comparisonRate} width={comparison} /><p className="text-[11px] leading-4 text-amber-300">{row.evidenceSnapshot.caveat ?? 'Observed association, not proven causation.'}</p></div>
        <div className="min-w-0 border-t border-gray-800 pt-3 xl:col-span-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0"><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Human review</p><label className="mt-2 block text-xs">Review note (optional)<input aria-label={`Review note for ${row.title}`} className="mt-1 w-full rounded border border-gray-700 bg-[#0d0d0d] px-3 py-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF5A1F]" maxLength={500} value={reviewNote} onChange={event => setReviewNote(event.target.value)} /></label>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void review(row.id, 'ACCEPTED_FOR_REVIEW')}>Accept for review</button><button type="button" className={button} disabled={busy} onClick={() => void review(row.id, 'REJECTED')}>Reject</button></div><p className="mt-2 text-[11px] text-gray-500">Acceptance records review intent; no policy changes.</p></div>
      </article>; })}</div>
    </section>
  </main>;
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <article className="min-w-0 rounded-xl border border-gray-800 bg-[#111111] p-4"><div className="flex items-center gap-2 text-gray-500">{icon}<p className="text-[11px] font-semibold uppercase tracking-wider">{label}</p></div><p className="mt-3 truncate text-lg font-semibold text-white">{value}</p><p className="mt-1 truncate text-xs text-gray-500">{detail}</p></article>;
}
function Rate({ label, successes, count, rate, width }: { label: string; successes: number; count: number; rate: number; width: number }) {
  return <div><div className="flex items-center justify-between gap-2 text-xs"><span className="text-gray-300">{label}</span><span className="tabular-nums text-white">{successes}/{count} · {rate}%</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#FF5A1F]" style={{ width: `${width}%` }} /></div></div>;
}
