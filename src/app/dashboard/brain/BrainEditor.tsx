'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { BrainKnowledgeCategory } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import MarketProfiles from './MarketProfiles';

type Entry = { id: string; category: BrainKnowledgeCategory; key: string; value: string; sourceType: string; verification: string; importance: number };
type View = { revision: number; compactSummary: string; entries: Entry[] };
type Draft = { id: string; category: BrainKnowledgeCategory; key: string; value: string };
const categories: BrainKnowledgeCategory[] = ['COMPANY', 'PRODUCT', 'OFFER', 'ICP', 'POSITIONING', 'DIFFERENTIATOR',
  'PAIN_POINT', 'VALUE_PROPOSITION', 'PROOF', 'CASE_STUDY', 'PRICING', 'COMMERCIAL_TERM', 'INTEGRATION',
  'OBJECTION_CONTEXT', 'TONE', 'CTA', 'SALES_PROCESS', 'FAQ', 'LIMITATION', 'MARKET', 'OTHER'];
export default function BrainEditor({ initial }: { initial: View }) {
  const [view, setView] = useState(initial);
  const [draft, setDraft] = useState<Draft>({ id: '', category: 'COMPANY', key: '', value: '' });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function reload() {
    const response = await fetch('/api/brain', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not refresh Brain knowledge.');
    const data = await response.json();
    setView({ revision: data.brain?.revision ?? 0, compactSummary: data.brain?.compactSummary ?? '', entries: data.entries ?? [] });
  }
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
  return <main className="mx-auto max-w-3xl space-y-6">
    <div className="flex gap-4"><Link href="/dashboard/scout/settings" className="text-sm text-primary hover:underline">Back to ICP settings</Link><Link href="/dashboard/playbook" className="text-sm text-primary hover:underline">Revenue Playbook</Link></div>
    <header><h1 className="text-2xl font-semibold">FrameLeads Brain</h1><p className="mt-2 text-sm text-muted-foreground">Persistent facts about your business. ICP and domain facts come from their existing settings and are read-only here.</p></header>
    <section className="rounded-xl border border-border/60 bg-card/50 p-5"><h2 className="text-sm font-semibold">Current summary <span className="font-normal text-muted-foreground">· revision {view.revision}</span></h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{view.compactSummary || 'No business knowledge saved yet.'}</p></section>
    <section className="rounded-xl border border-border/60 bg-card/50 p-5"><h2 className="text-sm font-semibold">{draft.id ? 'Edit knowledge' : 'Add knowledge'}</h2><div className="mt-4 space-y-3">
      <label className="block text-sm">Category<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as BrainKnowledgeCategory })} className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3">{categories.map(category => <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="block text-sm">Key<Input className="mt-1" maxLength={100} value={draft.key} onChange={event => setDraft({ ...draft, key: event.target.value })} /></label>
      <label className="block text-sm">Fact<textarea className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" rows={4} maxLength={2000} value={draft.value} onChange={event => setDraft({ ...draft, value: event.target.value })} /></label>
      <div className="flex gap-2"><Button type="button" disabled={pending || !draft.key.trim() || !draft.value.trim()} onClick={save}>{pending ? 'Saving...' : draft.id ? 'Save changes' : 'Add fact'}</Button>{draft.id && <Button type="button" variant="outline" onClick={() => setDraft({ id: '', category: 'COMPANY', key: '', value: '' })}>Cancel</Button>}</div>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div></section>
    <section className="rounded-xl border border-border/60 bg-card/50 p-5"><h2 className="text-sm font-semibold">Knowledge entries</h2>{view.entries.length ? <ul className="mt-4 space-y-3">{view.entries.map(entry => <li key={entry.id} className="rounded-lg border border-border/50 p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><span className="text-xs uppercase text-muted-foreground">{entry.category.replaceAll('_', ' ')} · {entry.sourceType.replaceAll('_', ' ')} · {entry.verification}</span><h3 className="mt-1 font-medium">{entry.key}</h3></div>{entry.sourceType === 'USER_ENTERED' && <div className="flex gap-2"><button type="button" className="text-primary underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setDraft({ id: entry.id, category: entry.category, key: entry.key, value: entry.value })}>Edit</button><button type="button" disabled={pending} className="text-red-300 underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => remove(entry.id)}>Remove</button></div>}</div><p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{entry.value}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No knowledge entries yet.</p>}</section>
    <MarketProfiles />
  </main>;
}
