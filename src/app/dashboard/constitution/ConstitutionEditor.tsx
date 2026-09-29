'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ConstitutionActionType, ConstitutionCategory, ConstitutionEffect, ConstitutionScope,
  ConstitutionSeverity, Prisma } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseNumericConditionValue } from '@/lib/sales-constitution-editor-validation';

type Kind = 'DISCOUNT_PERCENT' | 'MIN_CONTRACT_MONTHS' | 'PROHIBITED_CLAIM' | 'TOPIC' | 'UNSUBSCRIBE' | 'CUSTOM_MANUAL' | 'FACT' | 'ALL' | 'ANY';
type Field = 'QUALIFICATION_STATUS' | 'FIT_TIER' | 'PRIMARY_INTENT' | 'SECONDARY_INTENT' | 'CONFIDENCE' |
  'JOB_TITLE' | 'INDUSTRY' | 'COUNTRY' | 'COMPANY_SIZE' | 'RISK_BAND';
type Leaf = { kind: 'FACT'; field: Field; operator: string; value: string };
type EditorCondition = Leaf | { kind: 'ALL' | 'ANY'; conditions: Leaf[] };
const newLeaf = (): Leaf => ({ kind: 'FACT', field: 'FIT_TIER', operator: 'EQ', value: 'STRONG' });
const fields: Field[] = ['QUALIFICATION_STATUS','FIT_TIER','PRIMARY_INTENT','SECONDARY_INTENT','CONFIDENCE',
  'JOB_TITLE','INDUSTRY','COUNTRY','COMPANY_SIZE','RISK_BAND'];
const intentValues = ['POSITIVE_INTEREST','MEETING_REQUEST','PRICING_INQUIRY','PRICING_OBJECTION','TIMING_OBJECTION',
  'COMPETITOR_OBJECTION','TRUST_OBJECTION','BUDGET_OBJECTION','FEATURE_QUESTION','FEATURE_GAP','INTEGRATION_QUESTION',
  'SECURITY','PROCUREMENT','LEGAL','COMPLIANCE','REFERRAL','WRONG_PERSON','NOT_INTERESTED','UNSUBSCRIBE',
  'OUT_OF_OFFICE','NEUTRAL_QUESTION','CONFUSED','NEGOTIATION','EXISTING_CUSTOMER','SPAM','OTHER'];
const valueChoices: Partial<Record<Field, string[]>> = {
  QUALIFICATION_STATUS: ['UNASSESSED','QUALIFIED','REJECTED','NEEDS_REVIEW'],
  FIT_TIER: ['STRONG','MODERATE','WEAK','DISQUALIFIED'], PRIMARY_INTENT: intentValues,
  SECONDARY_INTENT: intentValues, RISK_BAND: ['LOW','MEDIUM','HIGH','CRITICAL'],
};
const operators = (field: Field) => field === 'SECONDARY_INTENT' ? ['CONTAINS'] :
  field === 'CONFIDENCE' || field === 'COMPANY_SIZE' ? ['LT','LTE','GT','GTE'] : ['EQ','NEQ'];
const initialValue = (field: Field) => valueChoices[field]?.[0] ?? (field === 'CONFIDENCE' || field === 'COMPANY_SIZE' ? '80' : '');
type Rule = { id: string; name: string; category: ConstitutionCategory; effect: ConstitutionEffect; description: string;
  constraint: Prisma.JsonValue; actionTypes: ConstitutionActionType[]; severity: ConstitutionSeverity;
  scope: ConstitutionScope; priority: number; enabled: boolean; source: string };
type Conflict = { ruleIds: [string, string]; rules: { id: string; name: string; effect: ConstitutionEffect }[];
  winningRuleId: string; winningEffect: ConstitutionEffect; explanation: string };
type View = { name: string; revision: number; rules: Rule[]; conflicts: Conflict[]; nextCursor: string | null };
type Draft = { id: string; name: string; category: ConstitutionCategory; effect: ConstitutionEffect; description: string;
  kind: Kind; actionTypes: ConstitutionActionType[]; severity: ConstitutionSeverity; scope: ConstitutionScope;
  priority: number; enabled: boolean; threshold: string;
  comparison: 'GT' | 'GTE'; minimum: string; terms: string; conditions: EditorCondition[] };
const categories: ConstitutionCategory[] = ['CLAIM','PRICING','DISCOUNT','COMMERCIAL_TERM','LEGAL','COMPLIANCE','SECURITY','PRIVACY',
  'DATA_HANDLING','CONTRACT','CAPABILITY','COMPETITOR','OUTREACH','UNSUBSCRIBE','COMMUNICATION','COMMITMENT','APPROVAL','CUSTOM'];
const actions: ConstitutionActionType[] = ['OUTREACH','DISCOUNT','CONTRACT','CLAIM','TOPIC_RESPONSE','COMMITMENT'];
const effects: ConstitutionEffect[] = ['BLOCK','REQUIRE_HUMAN','REQUIRE_APPROVAL','REQUIRE_SAFE_RESPONSE'];
const severities: ConstitutionSeverity[] = ['LOW','MEDIUM','HIGH','CRITICAL'];
const scopes: ConstitutionScope[] = ['GLOBAL','OUTBOUND','REPLY_DECISION','PRICING','COMMERCIAL','LEGAL','COMPLIANCE','SECURITY'];
const kinds: Kind[] = ['DISCOUNT_PERCENT','MIN_CONTRACT_MONTHS','PROHIBITED_CLAIM','TOPIC','UNSUBSCRIBE','CUSTOM_MANUAL','FACT','ALL','ANY'];
const empty: Draft = { id: '', name: '', category: 'CUSTOM', effect: 'REQUIRE_HUMAN', description: '',
  kind: 'CUSTOM_MANUAL', actionTypes: ['TOPIC_RESPONSE'], severity: 'MEDIUM', scope: 'GLOBAL',
  priority: 1, enabled: true, threshold: '', comparison: 'GT', minimum: '', terms: '', conditions: [newLeaf()] };
function fromRule(rule: Rule): Draft {
  const c = rule.constraint as { kind: Kind; threshold?: number; comparison?: 'GT' | 'GTE'; minimum?: number; terms?: string[];
    field?: Field; operator?: string; value?: string | number; conditions?: EditorCondition[] };
  return { id: rule.id, name: rule.name, category: rule.category, effect: rule.effect, description: rule.description,
    kind: c.kind, actionTypes: rule.actionTypes, severity: rule.severity, scope: rule.scope,
    priority: rule.priority, enabled: rule.enabled,
    threshold: c.threshold?.toString() ?? '', comparison: c.comparison ?? 'GT',
    minimum: c.minimum?.toString() ?? '', terms: c.terms?.join('\n') ?? '',
    conditions: c.kind === 'FACT' ? [{ kind: 'FACT', field: c.field!, operator: c.operator!, value: String(c.value) }] :
      c.kind === 'ALL' || c.kind === 'ANY' ? (c.conditions ?? []).map(item => item.kind === 'FACT' ?
        { ...item, value: String(item.value) } : { ...item, conditions: item.conditions.map(leaf => ({ ...leaf, value: String(leaf.value) })) }) : [newLeaf()] };
}
const emitLeaf = (leaf: Leaf) => ({ ...leaf, value: leaf.field === 'CONFIDENCE' || leaf.field === 'COMPANY_SIZE' ?
  parseNumericConditionValue(leaf.value) : leaf.value.trim() });
const emitCondition = (condition: EditorCondition): object => condition.kind === 'FACT' ? emitLeaf(condition) :
  { kind: condition.kind, conditions: condition.conditions.map(emitLeaf) };
function payload(draft: Draft) {
  const constraint = draft.kind === 'DISCOUNT_PERCENT' ? { kind: draft.kind, threshold: Number(draft.threshold), comparison: draft.comparison } :
    draft.kind === 'MIN_CONTRACT_MONTHS' ? { kind: draft.kind, minimum: Number(draft.minimum) } :
    draft.kind === 'PROHIBITED_CLAIM' ? { kind: draft.kind, terms: draft.terms.split(/\r?\n/).map(v => v.trim()).filter(Boolean) } :
    draft.kind === 'TOPIC' ? { kind: draft.kind, topic: draft.category } :
    draft.kind === 'FACT' ? emitCondition(draft.conditions[0]) :
    draft.kind === 'ALL' || draft.kind === 'ANY' ? { kind: draft.kind, conditions: draft.conditions.map(emitCondition) } : { kind: draft.kind };
  return { name: draft.name, category: draft.category, effect: draft.effect, description: draft.description,
    constraint, actionTypes: draft.actionTypes, severity: draft.severity, scope: draft.scope,
    priority: draft.priority, enabled: draft.enabled };
}
function selectKind(draft: Draft, kind: Kind): Draft {
  const forced = kind === 'DISCOUNT_PERCENT' ? 'DISCOUNT' : kind === 'MIN_CONTRACT_MONTHS' ? 'CONTRACT' :
    kind === 'PROHIBITED_CLAIM' ? 'CLAIM' : kind === 'UNSUBSCRIBE' ? 'OUTREACH' : null;
  const category = kind === 'DISCOUNT_PERCENT' ? 'DISCOUNT' : kind === 'MIN_CONTRACT_MONTHS' ? 'CONTRACT' :
    kind === 'PROHIBITED_CLAIM' ? 'CLAIM' :
    kind === 'UNSUBSCRIBE' ? 'UNSUBSCRIBE' : draft.category;
  return { ...draft, kind, category, actionTypes: forced ? [forced] : draft.actionTypes,
    conditions: kind === 'FACT' ? [draft.conditions[0]?.kind === 'FACT' ? draft.conditions[0] : newLeaf()] :
      kind === 'ALL' || kind === 'ANY' ? draft.conditions : draft.conditions };
}
function ConditionRow({ leaf, change, remove }: { leaf: Leaf; change: (next: Leaf) => void; remove?: () => void }) {
  const choices = valueChoices[leaf.field];
  return <div className="grid gap-2 rounded-lg border border-border/60 p-2 sm:grid-cols-[1fr_auto_1fr_auto]">
    <label className="text-xs">Field<select aria-label="Condition field" className="mt-1 h-9 w-full rounded border border-input bg-background px-2" value={leaf.field}
      onChange={e => { const field = e.target.value as Field; change({ kind: 'FACT', field, operator: operators(field)[0], value: initialValue(field) }); }}>
      {fields.map(field => <option key={field} value={field}>{field.replaceAll('_', ' ')}</option>)}</select></label>
    <label className="text-xs">Operator<select aria-label="Condition operator" className="mt-1 h-9 rounded border border-input bg-background px-2" value={leaf.operator}
      onChange={e => change({ ...leaf, operator: e.target.value })}>{operators(leaf.field).map(op => <option key={op}>{op}</option>)}</select></label>
    <label className="text-xs">Value{choices ? <select aria-label="Condition value" className="mt-1 h-9 w-full rounded border border-input bg-background px-2" value={leaf.value}
      onChange={e => change({ ...leaf, value: e.target.value })}>{choices.map(value => <option key={value}>{value}</option>)}</select> :
      <Input aria-label="Condition value" className="mt-1" type={leaf.field === 'CONFIDENCE' || leaf.field === 'COMPANY_SIZE' ? 'number' : 'text'}
        min={0} max={leaf.field === 'CONFIDENCE' ? 100 : undefined} maxLength={120} value={leaf.value}
        onChange={e => change({ ...leaf, value: e.target.value })} />}</label>
    {remove && <button type="button" className="self-end px-2 py-2 text-xs text-red-300 underline" onClick={remove}>Remove</button>}
  </div>;
}
export default function ConstitutionEditor({ initial }: { initial: View }) {
  const [view, setView] = useState(initial), [draft, setDraft] = useState<Draft>(empty);
  const [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const leaves = draft.conditions.reduce((sum, condition) => sum + (condition.kind === 'FACT' ? 1 : condition.conditions.length), 0);
  function updateCondition(index: number, next: EditorCondition | null) {
    setDraft(current => ({ ...current, conditions: next === null ? current.conditions.filter((_, i) => i !== index) :
      current.conditions.map((condition, i) => i === index ? next : condition) }));
  }
  async function request(url: string, method: string, body?: object) {
    const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Constitution change failed.');
    return data;
  }
  async function reload() {
    const data = await request('/api/constitution', 'GET');
    setView({ name: data.constitution.name, revision: data.constitution.revision, rules: data.rules,
      conflicts: data.conflicts, nextCursor: data.nextCursor });
  }
  async function save() {
    if (pending) return;
    setPending(true); setMessage('');
    try {
      if ((draft.kind === 'DISCOUNT_PERCENT' && !draft.threshold.trim()) ||
        (draft.kind === 'MIN_CONTRACT_MONTHS' && !draft.minimum.trim())) throw new Error('Enter the numeric threshold.');
      await request(draft.id ? `/api/constitution/rules/${encodeURIComponent(draft.id)}` : '/api/constitution/rules',
        draft.id ? 'PATCH' : 'POST', payload(draft));
      setDraft(empty); await reload(); setMessage('Rule saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save rule.'); }
    finally { setPending(false); }
  }
  async function changeRule(rule: Rule, action: 'toggle' | 'archive') {
    if (pending) return;
    setPending(true); setMessage('');
    try {
      await request(`/api/constitution/rules/${encodeURIComponent(rule.id)}`, action === 'archive' ? 'DELETE' : 'PATCH',
        action === 'toggle' ? { ...payload(fromRule(rule)), enabled: !rule.enabled } : undefined);
      await reload(); setMessage(action === 'archive' ? 'Rule archived.' : 'Rule updated.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not change rule.'); }
    finally { setPending(false); }
  }
  async function loadMore() {
    if (!view.nextCursor || pending) return;
    setPending(true); setMessage('');
    try {
      const data = await request(`/api/constitution?cursor=${encodeURIComponent(view.nextCursor)}`, 'GET');
      setView(current => ({ ...current, rules: [...current.rules, ...data.rules], conflicts: data.conflicts,
        nextCursor: data.nextCursor }));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load rules.'); }
    finally { setPending(false); }
  }
  return <main className="mx-auto max-w-3xl space-y-6">
    <Link href="/dashboard/playbook" className="text-sm text-primary hover:underline">Back to Revenue Playbook</Link>
    <header><h1 className="text-2xl font-semibold">Company Sales Constitution</h1>
      <p className="mt-2 text-sm text-muted-foreground">Hard sales boundaries. These rules constrain future decisions; this page does not execute actions.</p>
      <p className="mt-2 text-xs text-muted-foreground">{view.name} · revision {view.revision}</p></header>
    {view.conflicts.length > 0 && <section role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
      <h2 className="font-semibold">Conflicting active rules</h2><ul className="mt-2 space-y-1">{view.conflicts.map(conflict => <li key={conflict.ruleIds.join(':')}>
        {conflict.rules.map(rule => rule.name).join(' / ')} — {conflict.rules.find(rule => rule.id === conflict.winningRuleId)?.name} wins ({conflict.winningEffect.replaceAll('_', ' ')}).
      </li>)}</ul></section>}
    <section className="rounded-xl border border-border/60 bg-card/50 p-5"><h2 className="text-sm font-semibold">{draft.id ? 'Edit rule' : 'Add rule'}</h2>
      <div className="mt-4 space-y-3">
        <label className="block text-sm">Name<Input className="mt-1" maxLength={120} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="block text-sm">Hard boundary<textarea className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" rows={3} maxLength={3000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Constraint type<select className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3" value={draft.kind} onChange={e => setDraft(selectKind(draft, e.target.value as Kind))}>{kinds.map(k => <option key={k} value={k}>{k.replaceAll('_', ' ')}</option>)}</select></label>
          <label className="block text-sm">Category<select className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value as ConstitutionCategory })}>{categories.map(c => <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>)}</select></label></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Effect<select className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3" value={draft.effect} onChange={e => setDraft({ ...draft, effect: e.target.value as ConstitutionEffect })}>{effects.map(v => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}</select></label>
          <label className="block text-sm">Priority<select className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3" value={draft.priority} onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })}><option value={1}>Normal</option><option value={2}>High</option><option value={3}>Highest</option></select></label></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Severity<select className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3" value={draft.severity} onChange={e => setDraft({ ...draft, severity: e.target.value as ConstitutionSeverity })}>{severities.map(v => <option key={v} value={v}>{v}</option>)}</select></label>
          <label className="block text-sm">Scope<select className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3" value={draft.scope} onChange={e => setDraft({ ...draft, scope: e.target.value as ConstitutionScope })}>{scopes.map(v => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}</select></label></div>
        <fieldset><legend className="text-sm">Applies to actions</legend><div className="mt-1 flex flex-wrap gap-3">{actions.map(a => <label key={a} className="flex items-center gap-1 text-xs"><input type="checkbox" disabled={['DISCOUNT_PERCENT','MIN_CONTRACT_MONTHS','PROHIBITED_CLAIM','UNSUBSCRIBE'].includes(draft.kind)} checked={draft.actionTypes.includes(a)} onChange={e => setDraft({ ...draft, actionTypes: e.target.checked ? [...draft.actionTypes, a] : draft.actionTypes.filter(v => v !== a) })} />{a.replaceAll('_', ' ')}</label>)}</div></fieldset>
        {draft.kind === 'DISCOUNT_PERCENT' && <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Comparison<select className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3" value={draft.comparison} onChange={e => setDraft({ ...draft, comparison: e.target.value as 'GT' | 'GTE' })}><option value="GT">Above</option><option value="GTE">At or above</option></select></label><label className="text-sm">Discount threshold (%)<Input className="mt-1" type="number" min="0" max="100" step="0.01" value={draft.threshold} onChange={e => setDraft({ ...draft, threshold: e.target.value })} /></label></div>}
        {draft.kind === 'MIN_CONTRACT_MONTHS' && <label className="block text-sm">Minimum contract months<Input className="mt-1" type="number" min="1" max="1200" step="1" value={draft.minimum} onChange={e => setDraft({ ...draft, minimum: e.target.value })} /></label>}
        {draft.kind === 'PROHIBITED_CLAIM' && <label className="block text-sm">Prohibited phrases (one per line)<textarea className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" rows={3} value={draft.terms} onChange={e => setDraft({ ...draft, terms: e.target.value })} /></label>}
        {['FACT','ALL','ANY'].includes(draft.kind) && <fieldset className="space-y-2"><legend className="text-sm">Context conditions</legend>
          <p className="text-xs text-muted-foreground">Unknown facts remain unresolved and require review. Up to six conditions, two levels deep.</p>
          {draft.conditions.map((condition, index) => condition.kind === 'FACT' ?
            <ConditionRow key={index} leaf={condition} change={next => updateCondition(index, next)}
              remove={draft.kind !== 'FACT' && draft.conditions.length > 1 ? () => updateCondition(index, null) : undefined} /> :
            <div key={index} className="space-y-2 rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between"><span className="text-xs font-medium">{condition.kind} group</span>
                <button type="button" className="text-xs text-red-300 underline" onClick={() => updateCondition(index, null)}>Remove group</button></div>
              {condition.conditions.map((leaf, childIndex) => <ConditionRow key={childIndex} leaf={leaf}
                change={next => updateCondition(index, { ...condition, conditions: condition.conditions.map((item, i) => i === childIndex ? next : item) })}
                remove={condition.conditions.length > 1 ? () => updateCondition(index, { ...condition,
                  conditions: condition.conditions.filter((_, i) => i !== childIndex) }) : undefined} />)}
              <button type="button" disabled={leaves >= 6} className="text-xs text-primary underline disabled:opacity-40"
                onClick={() => updateCondition(index, { ...condition, conditions: [...condition.conditions, newLeaf()] })}>Add condition to group</button>
            </div>)}
          {draft.kind !== 'FACT' && <div className="flex gap-4">
            <button type="button" disabled={leaves >= 6} className="text-xs text-primary underline disabled:opacity-40"
              onClick={() => setDraft(current => ({ ...current, conditions: [...current.conditions, newLeaf()] }))}>Add condition</button>
            <button type="button" disabled={leaves >= 6} className="text-xs text-primary underline disabled:opacity-40"
              onClick={() => setDraft(current => ({ ...current, conditions: [...current.conditions, { kind: 'ALL', conditions: [newLeaf()] }] }))}>Add ALL group</button>
            <button type="button" disabled={leaves >= 6} className="text-xs text-primary underline disabled:opacity-40"
              onClick={() => setDraft(current => ({ ...current, conditions: [...current.conditions, { kind: 'ANY', conditions: [newLeaf()] }] }))}>Add ANY group</button>
          </div>}
        </fieldset>}
        <p className="text-xs text-muted-foreground">{draft.kind === 'CUSTOM_MANUAL' ? 'Manual review: this rule cannot be proven by the deterministic evaluator.' : 'Machine-evaluable when the future caller supplies the required structured facts. Missing facts require review.'}</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled</label>
        <div className="flex gap-2"><Button type="button" disabled={pending || !draft.name.trim() || !draft.description.trim() || !draft.actionTypes.length} onClick={save}>{pending ? 'Saving...' : draft.id ? 'Save changes' : 'Add rule'}</Button>{draft.id && <Button type="button" variant="outline" onClick={() => setDraft(empty)}>Cancel</Button>}</div>
      </div></section>
    <section className="rounded-xl border border-border/60 bg-card/50 p-5"><h2 className="text-sm font-semibold">Rules</h2>
      {view.rules.length ? <ul className="mt-4 space-y-3">{view.rules.map(rule => <li key={rule.id} className="rounded-lg border border-border/50 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><div><p className="text-xs uppercase text-muted-foreground">{rule.category.replaceAll('_', ' ')} · {rule.effect.replaceAll('_', ' ')} · {rule.severity} severity · {rule.scope.replaceAll('_', ' ')} scope · {rule.source.replaceAll('_', ' ')} · {rule.enabled ? 'Enabled' : 'Disabled'}</p><h3 className="mt-1 font-medium">{rule.name}</h3></div>{rule.source === 'USER_ENTERED' && <div className="flex gap-3"><button type="button" className="text-primary underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setDraft(fromRule(rule))}>Edit</button><button type="button" disabled={pending} className="text-primary underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => changeRule(rule, 'toggle')}>{rule.enabled ? 'Disable' : 'Enable'}</button><button type="button" disabled={pending} className="text-red-300 underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => changeRule(rule, 'archive')}>Archive</button></div>}</div><p className="mt-2 text-muted-foreground">{rule.description}</p><p className="mt-1 text-xs text-muted-foreground">{(rule.constraint as { kind?: string }).kind?.replaceAll('_', ' ')} · {rule.actionTypes.join(', ')} · Priority {rule.priority} · {(rule.constraint as { kind?: string }).kind === 'CUSTOM_MANUAL' ? 'Manual review required' : 'Structured evaluation'}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No boundaries configured. Add a rule to define what sales activity must not violate.</p>}
      {view.nextCursor && <Button type="button" variant="outline" className="mt-4" disabled={pending} onClick={loadMore}>Load more rules</Button>}
    </section>{message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
  </main>;
}
