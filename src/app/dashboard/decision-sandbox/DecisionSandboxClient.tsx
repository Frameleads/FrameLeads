'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bot, CircleDot, Scale, ShieldAlert, Timer } from 'lucide-react';
import FrameSelect from '@/components/ui/FrameSelect';

type DecisionOption = { id: string; createdAt: string; primaryIntent: string | null; status: string;
  prospect: { firstName: string; lastName: string; companyName: string | null } };
type SimulationView = { type: string; intent: { primary: string | null; secondary: string[]; confidence: number | null };
  constitution: { decision: string; effect: string | null; winningRule: string | null;
    winnerReason: string | null; matchedRuleIds: string[]; unresolvedRuleIds: string[];
    precedence: { ruleId: string; result: string; reason: string | null }[] }[];
  automation: { requestedMode: string; resolvedMode: string; state: string; reasons: string[];
    productionExecutionEnabled: boolean };
  risk: { status: string; score: number | null; band: string | null; confidence: string;
    reasons: string[]; simulatedBand: string | null };
  sla: { applicable: boolean; reason: string; durationMinutes: number | null;
    hypotheticalDueAt: string | null; sourceRiskBand: string | null };
  recommendedAction: string; suggestedReply: string | null; reviewRequired: boolean;
  explanation: string; aiUsed: boolean; simulatedAt: string };
const field = 'w-full min-w-0 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF5A1F]';

export default function DecisionSandboxClient() {
  const [decisions, setDecisions] = useState<DecisionOption[]>([]);
  const [search, setSearch] = useState('');
  const [decisionId, setDecisionId] = useState('');
  const [decisionsLoading, setDecisionsLoading] = useState(true);
  const [hypotheticalReply, setHypotheticalReply] = useState('');
  const [confidence, setConfidence] = useState('');
  const [riskBand, setRiskBand] = useState('');
  const [requestedMode, setRequestedMode] = useState('');
  const [holdActive, setHoldActive] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SimulationView | null>(null);
  useEffect(() => { void fetch('/api/decision-sandbox', { cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error('Decisions could not be loaded');
    return response.json();
  }).then(data => setDecisions(data.decisions)).catch(() => setError('Decisions could not be loaded.')).finally(() => setDecisionsLoading(false)); }, []);
  const filtered = useMemo(() => decisions.filter(row =>
    `${row.prospect.firstName} ${row.prospect.lastName} ${row.prospect.companyName ?? ''} ${row.primaryIntent ?? ''}`
      .toLowerCase().includes(search.toLowerCase())), [decisions, search]);
  async function run() {
    if (!decisionId || loading) return;
    setLoading(true); setError(''); setResult(null);
    const overrides: Record<string, unknown> = {};
    if (confidence !== '') overrides.confidence = Number(confidence);
    if (riskBand) overrides.riskBand = riskBand;
    if (requestedMode) overrides.requestedMode = requestedMode;
    if (holdActive) overrides.holdActive = holdActive === 'true';
    try {
      const response = await fetch('/api/decision-sandbox', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceDecisionId: decisionId,
          ...(hypotheticalReply.trim() ? { hypotheticalReply: hypotheticalReply.trim() } : {}), overrides }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Simulation failed');
      setResult(data.simulation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Simulation failed'); }
    finally { setLoading(false); }
  }
  return <main className="mx-auto w-full max-w-[1680px] space-y-6 py-6 text-white">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[.2em] text-[#FF5A1F]">Decision Intelligence</p>
      <h1 className="mt-2 text-2xl font-semibold">Decision Sandbox</h1>
      <p className="mt-2 max-w-3xl text-sm text-zinc-400">Dry-run the production decision and governance rules. No reply is sent and operational records stay unchanged.</p></div>
      <div className="rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-xs text-zinc-400">Simulation only <span className="ml-2 text-emerald-300">Nothing sent or persisted</span></div></header>
    <div className="flex min-w-0 flex-col gap-5">
    <section className="min-w-0 space-y-4 rounded-xl border border-white/10 bg-[#111111] p-4 sm:p-5" aria-label="Scenario builder">
      <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#FF5A1F]/10 text-xs font-bold text-[#FF5A1F]">01</span><div><h2 className="text-sm font-semibold">Scenario builder</h2><p className="text-xs text-zinc-500">Select a decision and apply hypothetical inputs.</p></div></div>
      <div className="grid gap-3 md:grid-cols-2">
      <label className="block min-w-0 text-sm">Find Decision
        <input className={`${field} mt-1`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search prospect, company or intent" /></label>
      <label className="block text-sm">Decision
        <FrameSelect className="mt-1" ariaLabel="Decision" value={decisionId} onValueChange={setDecisionId} placeholder="Select an existing Decision"
          options={filtered.map(row => ({ value: row.id, label: `${row.prospect.firstName} ${row.prospect.lastName} · ${row.prospect.companyName ?? 'Unknown company'} · ${row.primaryIntent ?? row.status}` }))} /></label>
      </div>
      {decisionsLoading && <p role="status" className="text-sm text-zinc-400">Loading available Decisions…</p>}
      {!decisionsLoading && !decisions.length && !error && <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-4"><p className="text-sm font-medium text-white">No Decisions are available yet.</p><p className="mt-1 text-xs text-zinc-400">Decisions appear in Inbox Triage when a reply is ready for review.</p><Link href="/dashboard/inbox-triage" className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border border-[#FF5A1F]/50 px-3 text-xs font-semibold text-[#FF5A1F] transition-colors hover:bg-[#FF5A1F]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]">Open Inbox Triage <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></div>}
      <label className="block text-sm">Hypothetical reply <span className="text-zinc-500">(optional; uses one AI analysis call)</span>
        <textarea className={`${field} mt-1 min-h-28`} maxLength={4000} value={hypotheticalReply}
          onChange={event => setHypotheticalReply(event.target.value)} placeholder="Enter an inbound reply to test explicitly" /></label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">Confidence override
          <input className={`${field} mt-1`} type="number" min={0} max={100} value={confidence}
            onChange={event => setConfidence(event.target.value)} placeholder="No override" /></label>
        <label className="block text-sm">Risk band override
          <FrameSelect className="mt-1" ariaLabel="Risk band override" value={riskBand} onValueChange={setRiskBand} options={[{ value: '', label: 'No override' }, ...['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(value => ({ value, label: value }))]} /></label>
        <label className="block text-sm">Requested mode
          <FrameSelect className="mt-1" ariaLabel="Requested mode override" value={requestedMode} onValueChange={setRequestedMode} options={[{ value: '', label: 'No override' }, ...['HUMAN_APPROVAL', 'AUTOPILOT', 'MANDATORY_ESCALATION'].map(value => ({ value, label: value }))]} /></label>
        <label className="block text-sm">Prospect hold
          <FrameSelect className="mt-1" ariaLabel="Prospect hold" value={holdActive} onValueChange={setHoldActive} options={[{ value: '', label: 'No override' }, { value: 'true', label: 'Held' }, { value: 'false', label: 'Not held' }]} /></label>
      </div>
      <button type="button" disabled={!decisionId || loading} onClick={() => void run()}
        className="min-h-10 rounded-md bg-[#FF5A1F] px-5 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#e94c15] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF5A1F] disabled:cursor-not-allowed disabled:opacity-50">
        {loading ? 'Simulating…' : 'Run Simulation'}</button>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </section>
    <section className="min-w-0" aria-live="polite" aria-label="Decision preview">
    {result ? <div className="space-y-4">
      <div className="rounded-xl border border-[#FF5A1F]/30 bg-[#17110e] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Decision · {result.type.replaceAll('_', ' ')}</p><h2 className="mt-2 text-xl font-semibold">{result.intent.primary ?? 'Intent unresolved'}</h2><p className="mt-1 text-sm text-zinc-400">{result.intent.confidence ?? '—'}% confidence · {result.aiUsed ? 'AI analysis used' : 'No AI call'}</p></div><div className="max-w-sm rounded-lg border border-white/10 bg-black/30 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Recommended action</p><p className="mt-1 text-sm font-medium">{result.recommendedAction}</p></div></div>
        {result.reviewRequired && <p className="mt-3 text-sm text-amber-300">Human review would be required.</p>}
      </div>
      <div className="grid min-w-0 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Panel title="Constitution" icon={<Scale className="h-4 w-4" aria-hidden="true" />}>{result.constitution.map((row, index) => <div key={index} className="mb-3 last:mb-0">
          <p>{row.decision} · {row.effect ?? 'Unresolved'}</p><p className="text-zinc-400">{row.winnerReason}</p>
          <p className="text-zinc-500">Matched: {row.matchedRuleIds.join(', ') || 'none'} · Unresolved: {row.unresolvedRuleIds.join(', ') || 'none'}</p>
          {row.precedence.filter(item => item.reason).map(item => <p key={item.ruleId} className="text-zinc-500">{item.ruleId}: {item.result} — {item.reason}</p>)}
        </div>)}</Panel>
        <Panel title="Automation" icon={<Bot className="h-4 w-4" aria-hidden="true" />}><p>{result.automation.resolvedMode} · {result.automation.state}</p>
          <p className="mt-2 text-zinc-400">{result.automation.reasons.join(', ') || 'No blocking reason'}</p>
          {!result.automation.productionExecutionEnabled && <p className="mt-2 text-amber-300">Production automatic execution is disabled.</p>}</Panel>
        <Panel title="Revenue Priority" icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}><p>{result.risk.status} · {result.risk.score ?? '—'} / 100 · {result.risk.band ?? 'Unknown'} · {result.risk.confidence} confidence</p>
          {result.risk.simulatedBand && <p className="mt-2 text-amber-300">SLA uses simulated {result.risk.simulatedBand} risk band.</p>}
          <p className="mt-2 text-zinc-400">{result.risk.reasons.join(' ')}</p></Panel>
        <Panel title="Response SLA" icon={<Timer className="h-4 w-4" aria-hidden="true" />}><p>{result.sla.applicable ? `${result.sla.durationMinutes} minutes` : 'Not applicable'}</p>
          <p className="mt-2 text-zinc-400">{result.sla.reason} · {result.sla.sourceRiskBand ?? 'Unknown band'}</p>
          {result.sla.hypotheticalDueAt && <p className="mt-2">Hypothetical deadline: {new Date(result.sla.hypotheticalDueAt).toLocaleString()}</p>}</Panel>
        <Panel title="Decision explanation" icon={<CircleDot className="h-4 w-4" aria-hidden="true" />} className="md:col-span-2 lg:col-span-4"><p className="whitespace-pre-wrap leading-6 text-zinc-300">{result.explanation}</p></Panel>
        {result.suggestedReply && <Panel title="Suggested reply" icon={<CircleDot className="h-4 w-4" aria-hidden="true" />} className="md:col-span-2 lg:col-span-4"><p className="whitespace-pre-wrap leading-6 text-zinc-300">{result.suggestedReply}</p></Panel>}
      </div>
    </div> : <div className="rounded-xl border border-white/10 bg-[#111111] p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Decision preview</p><h2 className="mt-2 text-lg font-semibold">Governance simulation</h2>
      <p className="mt-1 max-w-xl text-sm text-zinc-400">Run a scenario to preview how FrameLeads would govern it. Nothing is sent or persisted.</p>
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[['Reply', CircleDot], ['Decision', CircleDot], ['Constitution', Scale], ['Automation', Bot], ['Risk / SLA', ShieldAlert]].map(([label, Icon], index) => { const StepIcon = Icon as typeof CircleDot; return <div key={label as string} className="relative flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/20 p-3 text-center"><StepIcon className="h-4 w-4 text-[#FF5A1F]" aria-hidden="true" /><span className="text-xs font-medium text-zinc-300">{label as string}</span><span className="text-[10px] text-zinc-600">0{index + 1}</span></div>; })}
      </div>
      <p className="mt-6 text-xs text-zinc-500">Use an existing Decision to see its intent, governance rules, operating mode, risk and SLA outcome.</p>
    </div>}
    </section>
    </div>
  </main>;
}

function Panel({ title, icon, className = '', children }: { title: string; icon: React.ReactNode; className?: string; children: React.ReactNode }) {
  return <article className={`min-w-0 rounded-lg border border-white/10 bg-[#111111] p-4 text-sm ${className}`}><h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">{icon}{title}</h2>{children}</article>;
}
