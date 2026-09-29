'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { BrainKnowledgeCategory } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import FrameSelect from '@/components/ui/FrameSelect';
import { useCorePaywallLocked } from '@/components/CorePaywall';

type Entry = { id: string; category: BrainKnowledgeCategory; key: string; value: string; sourceType: string; verification: string; importance: number };
type View = { revision: number; compactSummary: string; entries: Entry[] };
type Draft = { id: string; category: BrainKnowledgeCategory; key: string; value: string };
const categories: BrainKnowledgeCategory[] = ['COMPANY', 'PRODUCT', 'OFFER', 'ICP', 'POSITIONING', 'DIFFERENTIATOR',
  'PAIN_POINT', 'VALUE_PROPOSITION', 'PROOF', 'CASE_STUDY', 'PRICING', 'COMMERCIAL_TERM', 'INTEGRATION',
  'OBJECTION_CONTEXT', 'TONE', 'CTA', 'SALES_PROCESS', 'FAQ', 'LIMITATION', 'MARKET', 'OTHER'];
export default function BrainEditor({ initial }: { initial: View }) {
  const paywallLocked = useCorePaywallLocked();
  const [view, setView] = useState(initial);
  const [draft, setDraft] = useState<Draft>({ id: '', category: 'COMPANY', key: '', value: '' });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const reload = useCallback(async () => {
    const response = await fetch('/api/brain', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not refresh Brain knowledge.');
    const data = await response.json();
    setView({ revision: data.brain?.revision ?? 0, compactSummary: data.brain?.compactSummary ?? '', entries: data.entries ?? [] });
  }, []);
  useEffect(() => {
    if (paywallLocked) return;
    void reload().catch(() => setMessage('Canonical Brain knowledge could not be refreshed.'));
  }, [reload, paywallLocked]);
  async function save() {
    if (pending) return;
    setPending(true); setMessage('');
    try {
      const response = await fetch(draft.id ? `/api/brain/${encodeURIComponent(draft.id)}` : '/api/brain', {
        method: draft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: draft.category, key: draft.key, value: draft.value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save knowledge.');
      setDraft({ id: '', category: 'COMPANY', key: '', value: '' });
      await reload(); setMessage('Knowledge saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save knowledge.'); }
    finally { setPending(false); }
  }
  async function remove(id: string) {
    if (pending) return;
    setPending(true); setMessage('');
    try {
      const response = await fetch(`/api/brain/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not remove knowledge.');
      if (draft.id === id) setDraft({ id: '', category: 'COMPANY', key: '', value: '' });
      await reload(); setMessage('Knowledge removed.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not remove knowledge.'); }
    finally { setPending(false); }
  }
  return <main className="mx-auto w-full max-w-[1680px] space-y-6">
    <div className="flex flex-wrap gap-4"><Link href="/dashboard/scout/settings" className="text-sm text-primary hover:underline">ICP Profile</Link><Link href="/dashboard/market-profiles" className="text-sm text-primary hover:underline">Market Profiles</Link><Link href="/dashboard/playbook" className="text-sm text-primary hover:underline">Revenue Playbook</Link></div>
    <header><h1 className="text-2xl font-semibold">FrameLeads Brain</h1><p className="mt-2 text-sm text-muted-foreground">Persistent facts about your business. ICP and domain facts come from their existing settings and are read-only here.</p></header>
    <section className="rounded-xl border border-border/60 bg-card/50 p-5"><h2 className="text-sm font-semibold">Current summary <span className="font-normal text-muted-foreground">· revision {view.revision}</span></h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{view.compactSummary || 'No business knowledge saved yet.'}</p></section>
    <section className="rounded-xl border border-border/60 bg-card/40 p-5"><h2 className="text-sm font-semibold">{draft.id ? 'Edit knowledge' : 'Add knowledge'}</h2>
      <div className="mt-4 grid items-end gap-4 md:grid-cols-2 xl:grid-cols-12">
        <label className="flex min-w-0 flex-col gap-2 text-sm xl:col-span-3"><span className="leading-5">Category</span><FrameSelect ariaLabel="Knowledge category" value={draft.category} onValueChange={value => setDraft({ ...draft, category: value as BrainKnowledgeCategory })} options={categories.map(category => ({ value: category, label: category.replaceAll('_', ' ') }))} /></label>
        <label className="flex min-w-0 flex-col gap-2 text-sm xl:col-span-3"><span className="leading-5">Key</span><Input maxLength={100} value={draft.key} onChange={event => setDraft({ ...draft, key: event.target.value })} /></label>
        <label className="flex min-w-0 flex-col gap-2 text-sm xl:col-span-4"><span className="leading-5">Fact</span><textarea className="h-10 min-h-10 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm" rows={1} maxLength={2000} value={draft.value} onChange={event => setDraft({ ...draft, value: event.target.value })} /></label>
        <div className="flex flex-wrap items-end gap-2 xl:col-span-2"><Button className="h-10" type="button" disabled={pending || !draft.key.trim() || !draft.value.trim()} onClick={save}>{pending ? 'Saving...' : draft.id ? 'Save changes' : 'Add fact'}</Button>{draft.id && <Button className="h-10" type="button" variant="outline" onClick={() => setDraft({ id: '', category: 'COMPANY', key: '', value: '' })}>Cancel</Button>}</div>
      </div>{message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </section>
    <section className="rounded-xl border border-border/60 bg-card/50 p-5"><h2 className="text-sm font-semibold">Knowledge entries <span className="ml-2 font-normal text-muted-foreground">{view.entries.length} stored</span></h2>{view.entries.length ? <ul className="mt-4 grid gap-3 xl:grid-cols-2">{view.entries.map(entry => <li key={entry.id} className="min-w-0 rounded-lg border border-border/50 p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><span className="text-xs uppercase text-muted-foreground">{entry.category.replaceAll('_', ' ')} · {entry.sourceType.replaceAll('_', ' ')} · {entry.verification}</span><h3 className="mt-1 font-medium">{entry.key}</h3></div>{entry.sourceType === 'USER_ENTERED' && <div className="flex gap-2"><button type="button" className="text-primary underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setDraft({ id: entry.id, category: entry.category, key: entry.key, value: entry.value })}>Edit</button><button type="button" disabled={pending} className="text-red-300 underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => remove(entry.id)}>Remove</button></div>}</div><p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{entry.value}</p></li>)}</ul> : <p className="mt-3 rounded-lg border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">No knowledge entries yet. Add a fact above to build your company knowledge base.</p>}</section>
  </main>;
}
