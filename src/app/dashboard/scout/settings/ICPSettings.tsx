'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import FrameSelect from '@/components/ui/FrameSelect';

type ListField = 'targetTitles' | 'targetSeniorities' | 'targetIndustries' | 'targetGeographies' | 'excludedTitles' | 'excludedIndustries' | 'excludedDomains' | 'requiredKeywords' | 'excludedKeywords';
type Settings = Record<ListField, string[]> & { name: string; isActive: boolean; qualificationPolicy: 'CONSERVATIVE' | 'BALANCED' | 'STRICT'; companySizeMin: number | null; companySizeMax: number | null };
const fields: { key: ListField; label: string }[] = [
  { key: 'targetTitles', label: 'Target titles' }, { key: 'targetSeniorities', label: 'Target seniorities' },
  { key: 'targetIndustries', label: 'Target industries' }, { key: 'targetGeographies', label: 'Target geographies' },
  { key: 'excludedTitles', label: 'Excluded titles' }, { key: 'excludedIndustries', label: 'Excluded industries' },
  { key: 'excludedDomains', label: 'Excluded domains' }, { key: 'requiredKeywords', label: 'Required keywords' },
  { key: 'excludedKeywords', label: 'Excluded keywords' },
];
const empty: Settings = { name: 'Default ICP', isActive: true, qualificationPolicy: 'CONSERVATIVE', targetTitles: [], targetSeniorities: [], targetIndustries: [], targetGeographies: [], excludedTitles: [], excludedIndustries: [], excludedDomains: [], requiredKeywords: [], excludedKeywords: [], companySizeMin: null, companySizeMax: null };
const split = (value: string) => value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);

export default function ICPSettings({ initial }: { initial: Settings | null }) {
  const router = useRouter();
  const [data, setData] = useState<Settings>(initial ?? empty);
  const [drafts, setDrafts] = useState<Record<ListField, string>>(() => Object.fromEntries(fields.map(field => [field.key, (initial ?? empty)[field.key].join('\n')])) as Record<ListField, string>);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    if (pending) return;
    setPending(true); setMessage('');
    try {
      const payload = { ...data, ...Object.fromEntries(fields.map(field => [field.key, split(drafts[field.key])])) };
      const response = await fetch('/api/scout/icp', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save ICP profile.');
      setMessage('ICP saved. Run qualification in Scout to update prospect eligibility.');
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save ICP profile.'); }
    finally { setPending(false); }
  }
  return <div className="mx-auto w-full max-w-[1680px] min-w-0 space-y-6 px-1 sm:px-0">
    <div className="flex flex-wrap gap-4"><Link href="/dashboard/scout" className="text-sm text-primary hover:underline">Back to Scout</Link><Link href="/dashboard/brain" className="text-sm text-primary hover:underline">FrameLeads Brain</Link></div>
    <header><h1 className="text-2xl font-semibold">ICP settings</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Deterministic rules use known stored facts only. Unknown facts lead to review, not automatic rejection. Enter one item per line.</p></header>
    <div className="w-full min-w-0 max-w-full space-y-5 rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6">
      <div className="grid w-full min-w-0 max-w-full gap-4 lg:grid-cols-2">
        <div className="w-full min-w-0 max-w-full space-y-3 rounded-lg border border-border/50 bg-background/30 p-4"><h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Profile / activation</h2>
          <label className="block space-y-2 text-sm"><span>Profile name</span><Input value={data.name} onChange={event => setData({ ...data, name: event.target.value })} /></label>
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={data.isActive} onChange={event => setData({ ...data, isActive: event.target.checked })} /> Active ICP</label></div>
        <label className="block w-full min-w-0 max-w-full space-y-2 rounded-lg border border-border/50 bg-background/30 p-4 text-sm"><span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Qualification policy</span><FrameSelect className="w-full" ariaLabel="Qualification policy" value={data.qualificationPolicy} onValueChange={value => setData({ ...data, qualificationPolicy: value as Settings['qualificationPolicy'] })} options={[{ value: 'CONSERVATIVE', label: 'Conservative — only explicit exclusions auto-reject' }, { value: 'BALANCED', label: 'Balanced — multiple clear mismatches may reject' }, { value: 'STRICT', label: 'Strict — known target mismatches may reject' }]} /></label>
      </div>
      <div className="grid w-full min-w-0 max-w-full gap-4 md:grid-cols-2 xl:grid-cols-4">{fields.slice(0, 4).map(field => <label key={field.key} className="block w-full min-w-0 max-w-full space-y-2 text-sm"><span>{field.label}</span><textarea value={drafts[field.key]} onChange={event => setDrafts({ ...drafts, [field.key]: event.target.value })} rows={3} className="w-full min-w-0 max-w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>)}</div>
      <div className="grid w-full min-w-0 max-w-full gap-4 xl:grid-cols-12">
        <div className="w-full min-w-0 max-w-full space-y-4 rounded-lg border border-border/50 bg-background/20 p-4 xl:col-span-3"><h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Company size</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">{(['companySizeMin', 'companySizeMax'] as const).map(key => <label key={key} className="block space-y-2 text-sm"><span>{key === 'companySizeMin' ? 'Minimum' : 'Maximum'} employees</span><Input type="number" min={0} value={data[key] ?? ''} onChange={event => setData({ ...data, [key]: event.target.value === '' ? null : Number(event.target.value) })} /></label>)}</div></div>
        <label className="block w-full min-w-0 max-w-full space-y-2 rounded-lg border border-border/50 bg-background/20 p-4 text-sm xl:col-span-3"><span>Required keywords</span><textarea value={drafts.requiredKeywords} onChange={event => setDrafts({ ...drafts, requiredKeywords: event.target.value })} rows={5} className="w-full min-w-0 max-w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
        <div className="grid w-full min-w-0 max-w-full gap-4 sm:grid-cols-2 xl:col-span-6">{fields.slice(4).filter(field => field.key !== 'requiredKeywords').map(field => <label key={field.key} className="block w-full min-w-0 max-w-full space-y-2 rounded-lg border border-border/50 bg-background/20 p-4 text-sm"><span>{field.label}</span><textarea value={drafts[field.key]} onChange={event => setDrafts({ ...drafts, [field.key]: event.target.value })} rows={4} className="w-full min-w-0 max-w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>)}</div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border/50 pt-4"><Button type="button" onClick={save} disabled={pending} aria-busy={pending}>{pending ? 'Saving...' : 'Save ICP'}</Button>{message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}</div>
    </div>
  </div>;
}
