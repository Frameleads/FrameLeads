'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { RevenueScenario, RevenueDirection, ProspectQualificationStatus } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Rule = { id: string; name: string; scenario: RevenueScenario; customScenario: string | null; objective: string;
  guidance: string; nextAction: string; responsePrinciples: string[]; ctaGuidance: string | null;
  qualificationCondition: ProspectQualificationStatus | null; direction: RevenueDirection | null;
  priority: number; enabled: boolean; source: string };
type Draft = Omit<Rule, 'source' | 'responsePrinciples'> & { responsePrinciples: string };
type View = { name: string; revision: number; rules: Rule[]; nextCursor: string | null };
const scenarios: RevenueScenario[] = ['GENERAL','PRICING','DISCOUNT','BUDGET','INTEGRATION','SECURITY','LEGAL','COMPLIANCE',
  'PROCUREMENT','TIMING','NOT_NOW','FEATURE','FEATURE_GAP','IMPLEMENTATION','ONBOARDING','PROOF','CASE_STUDY',
  'COMPETITOR','AUTHORITY','STAKEHOLDER','MEETING','DEMO','TRIAL','PILOT','POSITIVE_INTENT','OBJECTION',
  'SILENCE_FOLLOWUP','NEGATIVE_REPLY','UNSUBSCRIBE','CUSTOM'];
const empty: Draft = { id: '', name: '', scenario: 'GENERAL', customScenario: null, objective: '', guidance: '', nextAction: '',
  responsePrinciples: '', ctaGuidance: null, qualificationCondition: null, direction: null, priority: 1, enabled: true };
function payload(rule: Draft | Rule) { return { name: rule.name, scenario: rule.scenario, customScenario: rule.customScenario,
  objective: rule.objective, guidance: rule.guidance, nextAction: rule.nextAction,
  responsePrinciples: typeof rule.responsePrinciples === 'string' ? rule.responsePrinciples.split(/\r?\n/).map(x => x.trim()).filter(Boolean) : rule.responsePrinciples,
  ctaGuidance: rule.ctaGuidance, qualificationCondition: rule.qualificationCondition, direction: rule.direction,
  priority: rule.priority, enabled: rule.enabled }; }
export default function PlaybookEditor({ initial }: { initial: View }) {
  const [view, setView] = useState(initial);
  const [draft, setDraft] = useState<Draft>(empty);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function reload() {
    const response = await fetch('/api/playbook', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not refresh Playbook.');
    const data = await response.json();
    setView({ name: data.playbook.name, revision: data.playbook.revision, rules: data.rules, nextCursor: data.nextCursor });
  }
  async function loadMore() {
    if (!view.nextCursor || pending) return;
    setPending(true); setMessage('');
    try {
      const response = await fetch(`/api/playbook?cursor=${encodeURIComponent(view.nextCursor)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load more rules.');
      const data = await response.json();
      setView(current => ({ ...current, rules: [...current.rules, ...data.rules], nextCursor: data.nextCursor }));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load more rules.'); }
    finally { setPending(false); }
  }
  async function request(url: string, method: string, body?: object) {
    const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Playbook change failed.');
  }
  async function save() {
    if (pending) return;
    setPending(true); setMessage('');
    try {
      await request(draft.id ? `/api/playbook/rules/${encodeURIComponent(draft.id)}` : '/api/playbook/rules', draft.id ? 'PATCH' : 'POST', payload(draft));
      setDraft(empty); await reload(); setMessage('Rule saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Rule could not be saved.'); }
    finally { setPending(false); }
  }
  async function changeRule(rule: Rule, action: 'toggle' | 'archive') {
    if (pending) return;
    setPending(true); setMessage('');
    try {
      await request(`/api/playbook/rules/${encodeURIComponent(rule.id)}`, action === 'archive' ? 'DELETE' : 'PATCH',
        action === 'toggle' ? { ...payload(rule), enabled: !rule.enabled } : undefined);
      await reload(); setMessage(action === 'archive' ? 'Rule archived.' : 'Rule updated.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Rule could not be changed.'); }
    finally { setPending(false); }
  }
  return <main className="mx-auto max-w-3xl space-y-6">
    <div className="flex gap-4"><Link href="/dashboard/brain" className="text-sm text-primary hover:underline">Back to Brain</Link><Link href="/dashboard/constitution" className="text-sm text-primary hover:underline">Company Sales Constitution</Link></div>
    <header><h1 className="text-2xl font-semibold">Revenue Playbook</h1><p className="mt-2 text-sm text-muted-foreground">Preferred handling for recurring sales situations. These rules are guidance, not enforced limits or automatic actions.</p><p className="mt-2 text-xs text-muted-foreground">{view.name} · revision {view.revision}</p></header>
    <section className="rounded-xl border border-border/60 bg-card/50 p-5"><h2 className="text-sm font-semibold">{draft.id ? 'Edit rule' : 'Add rule'}</h2><div className="mt-4 space-y-3">
      <label className="block text-sm">Name<Input className="mt-1" maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Scenario<select className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3" value={draft.scenario} onChange={event => setDraft({ ...draft, scenario: event.target.value as RevenueScenario, customScenario: null })}>{scenarios.map(s => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}</select></label><label className="block text-sm">Priority<select className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3" value={draft.priority} onChange={event => setDraft({ ...draft, priority: Number(event.target.value) })}><option value={1}>Normal</option><option value={2}>High</option><option value={3}>Highest</option></select></label></div>
      {draft.scenario === 'CUSTOM' && <label className="block text-sm">Custom situation<Input className="mt-1" maxLength={100} value={draft.customScenario ?? ''} onChange={event => setDraft({ ...draft, customScenario: event.target.value })} /></label>}
      <label className="block text-sm">Objective<textarea className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" rows={2} maxLength={1000} value={draft.objective} onChange={event => setDraft({ ...draft, objective: event.target.value })} /></label>
      <label className="block text-sm">Handling guidance<textarea className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" rows={4} maxLength={3000} value={draft.guidance} onChange={event => setDraft({ ...draft, guidance: event.target.value })} /></label>
      <label className="block text-sm">Preferred next action<textarea className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" rows={2} maxLength={1000} value={draft.nextAction} onChange={event => setDraft({ ...draft, nextAction: event.target.value })} /></label>
      <label className="block text-sm">Response principles (one per line, optional)<textarea className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" rows={2} value={draft.responsePrinciples} onChange={event => setDraft({ ...draft, responsePrinciples: event.target.value })} /></label>
      <label className="block text-sm">CTA guidance (optional)<Input className="mt-1" maxLength={500} value={draft.ctaGuidance ?? ''} onChange={event => setDraft({ ...draft, ctaGuidance: event.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Direction<select className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3" value={draft.direction ?? ''} onChange={event => setDraft({ ...draft, direction: event.target.value ? event.target.value as RevenueDirection : null })}><option value="">Any</option><option value="INBOUND">Inbound</option><option value="OUTBOUND">Outbound</option></select></label><label className="block text-sm">Qualification<select className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3" value={draft.qualificationCondition ?? ''} onChange={event => setDraft({ ...draft, qualificationCondition: event.target.value ? event.target.value as ProspectQualificationStatus : null })}><option value="">Any</option><option value="UNASSESSED">Unassessed</option><option value="QUALIFIED">Qualified</option><option value="REJECTED">Rejected</option><option value="NEEDS_REVIEW">Needs review</option></select></label></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /> Enabled</label>
      <div className="flex gap-2"><Button type="button" disabled={pending || !draft.name.trim() || !draft.objective.trim() || !draft.guidance.trim() || !draft.nextAction.trim()} onClick={save}>{pending ? 'Saving...' : draft.id ? 'Save changes' : 'Add rule'}</Button>{draft.id && <Button type="button" variant="outline" onClick={() => setDraft(empty)}>Cancel</Button>}</div>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div></section>
    <section className="rounded-xl border border-border/60 bg-card/50 p-5"><h2 className="text-sm font-semibold">Rules</h2>{view.rules.length ? <ul className="mt-4 space-y-3">{view.rules.map(rule => <li key={rule.id} className="rounded-lg border border-border/50 p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs uppercase text-muted-foreground">{rule.scenario.replaceAll('_', ' ')} · {rule.source.replaceAll('_', ' ')} · {rule.enabled ? 'Enabled' : 'Disabled'} · Priority {rule.priority}</p><h3 className="mt-1 font-medium">{rule.name}</h3></div>{rule.source === 'USER_ENTERED' && <div className="flex flex-wrap gap-3"><button type="button" className="text-primary underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setDraft({ ...rule, responsePrinciples: rule.responsePrinciples.join('\n') })}>Edit</button><button type="button" disabled={pending} className="text-primary underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => changeRule(rule, 'toggle')}>{rule.enabled ? 'Disable' : 'Enable'}</button><button type="button" disabled={pending} className="text-red-300 underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => changeRule(rule, 'archive')}>Archive</button></div>}</div><p className="mt-2 text-muted-foreground"><strong>Objective:</strong> {rule.objective}</p><p className="mt-1 text-muted-foreground"><strong>Guidance:</strong> {rule.guidance}</p><p className="mt-1 text-muted-foreground"><strong>Next:</strong> {rule.nextAction}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No handling rules yet. Add guidance for a situation your team encounters.</p>}{view.nextCursor && <Button type="button" variant="outline" className="mt-4" disabled={pending} onClick={loadMore}>Load more rules</Button>}</section>
  </main>;
}
