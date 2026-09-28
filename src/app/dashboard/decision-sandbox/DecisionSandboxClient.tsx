'use client';

import { useEffect, useMemo, useState } from 'react';

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
const field = 'w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400';

export default function DecisionSandboxClient() {
  const [decisions, setDecisions] = useState<DecisionOption[]>([]);
  const [search, setSearch] = useState('');
  const [decisionId, setDecisionId] = useState('');
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
  }).then(data => setDecisions(data.decisions)).catch(() => setError('Decisions could not be loaded.')); }, []);
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
  return <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 text-white sm:px-8">
    <header><p className="text-xs uppercase tracking-[.2em] text-cyan-400">Decision Intelligence</p>
      <h1 className="mt-2 text-2xl font-semibold">Decision Sandbox</h1>
      <p className="mt-2 text-sm text-zinc-400">Dry-run the production decision and governance rules. No reply is sent and operational records stay unchanged.</p></header>
    <section className="space-y-4 rounded-xl border border-white/10 bg-white/[.03] p-4 sm:p-6" aria-label="Simulation inputs">
      <label className="block text-sm">Find Decision
        <input className={`${field} mt-1`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search prospect, company or intent" /></label>
      <label className="block text-sm">Decision
        <select className={`${field} mt-1`} value={decisionId} onChange={event => setDecisionId(event.target.value)}>
          <option value="">Select an existing Decision</option>
          {filtered.map(row => <option key={row.id} value={row.id}>{row.prospect.firstName} {row.prospect.lastName} · {row.prospect.companyName ?? 'Unknown company'} · {row.primaryIntent ?? row.status}</option>)}
        </select></label>
      {!decisions.length && !error && <p className="text-sm text-zinc-400">No Decisions are available yet.</p>}
      <label className="block text-sm">Hypothetical reply <span className="text-zinc-500">(optional; uses one AI analysis call)</span>
        <textarea className={`${field} mt-1 min-h-28`} maxLength={4000} value={hypotheticalReply}
          onChange={event => setHypotheticalReply(event.target.value)} placeholder="Enter an inbound reply to test explicitly" /></label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">Confidence override
          <input className={`${field} mt-1`} type="number" min={0} max={100} value={confidence}
            onChange={event => setConfidence(event.target.value)} placeholder="No override" /></label>
        <label className="block text-sm">Risk band override
          <select className={`${field} mt-1`} value={riskBand} onChange={event => setRiskBand(event.target.value)}>
            <option value="">No override</option>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(value => <option key={value}>{value}</option>)}
          </select></label>
        <label className="block text-sm">Requested mode
          <select className={`${field} mt-1`} value={requestedMode} onChange={event => setRequestedMode(event.target.value)}>
            <option value="">No override</option>{['HUMAN_APPROVAL', 'AUTOPILOT', 'MANDATORY_ESCALATION'].map(value => <option key={value}>{value}</option>)}
          </select></label>
        <label className="block text-sm">Prospect hold
          <select className={`${field} mt-1`} value={holdActive} onChange={event => setHoldActive(event.target.value)}>
            <option value="">No override</option><option value="true">Held</option><option value="false">Not held</option>
          </select></label>
      </div>
      <button type="button" disabled={!decisionId || loading} onClick={() => void run()}
        className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50">
        {loading ? 'Simulating…' : 'Run Simulation'}</button>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </section>
    {result && <section className="space-y-4" aria-live="polite" aria-label="Simulation result">
      <p className="text-xs uppercase tracking-widest text-zinc-400">{result.type.replaceAll('_', ' ')} · {result.aiUsed ? 'AI analysis used' : 'No AI call'}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Decision"><p>{result.intent.primary ?? 'Intent unresolved'} · {result.intent.confidence ?? '—'}% confidence</p>
          <p className="mt-2 text-zinc-400">{result.explanation}</p><p className="mt-2">Recommended: {result.recommendedAction}</p>
          {result.suggestedReply && <p className="mt-2 whitespace-pre-wrap text-zinc-300">Draft: {result.suggestedReply}</p>}</Panel>
        <Panel title="Constitution">{result.constitution.map((row, index) => <div key={index} className="mb-3">
          <p>{row.decision} · {row.effect ?? 'Unresolved'}</p><p className="text-zinc-400">{row.winnerReason}</p>
          <p className="text-zinc-500">Matched: {row.matchedRuleIds.join(', ') || 'none'} · Unresolved: {row.unresolvedRuleIds.join(', ') || 'none'}</p>
          {row.precedence.filter(item => item.reason).map(item => <p key={item.ruleId} className="text-zinc-500">{item.ruleId}: {item.result} — {item.reason}</p>)}
        </div>)}</Panel>
        <Panel title="Automation"><p>{result.automation.resolvedMode} · {result.automation.state}</p>
          <p className="mt-2 text-zinc-400">{result.automation.reasons.join(', ') || 'No blocking reason'}</p>
          {!result.automation.productionExecutionEnabled && <p className="mt-2 text-amber-300">Production automatic execution is disabled.</p>}</Panel>
        <Panel title="Revenue Risk"><p>{result.risk.status} · {result.risk.score ?? '—'} / 100 · {result.risk.band ?? 'Unknown'} · {result.risk.confidence} confidence</p>
          {result.risk.simulatedBand && <p className="mt-2 text-amber-300">SLA uses simulated {result.risk.simulatedBand} risk band.</p>}
          <p className="mt-2 text-zinc-400">{result.risk.reasons.join(' ')}</p></Panel>
        <Panel title="Response SLA"><p>{result.sla.applicable ? `${result.sla.durationMinutes} minutes` : 'Not applicable'}</p>
          <p className="mt-2 text-zinc-400">{result.sla.reason} · {result.sla.sourceRiskBand ?? 'Unknown band'}</p>
          {result.sla.hypotheticalDueAt && <p className="mt-2">Hypothetical deadline: {new Date(result.sla.hypotheticalDueAt).toLocaleString()}</p>}</Panel>
      </div>
      {result.reviewRequired && <p className="text-sm text-amber-300">Human review would be required.</p>}
    </section>}
  </main>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="rounded-xl border border-white/10 bg-white/[.03] p-4 text-sm"><h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-cyan-400">{title}</h2>{children}</article>;
}
