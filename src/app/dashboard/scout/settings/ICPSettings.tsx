'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  return <div className="mx-auto max-w-3xl space-y-6">
    <Link href="/dashboard/scout" className="text-sm text-primary hover:underline">Back to Scout</Link>
    <header><h1 className="text-2xl font-semibold">ICP settings</h1><p className="mt-2 text-sm text-muted-foreground">Deterministic rules use known stored facts only. Unknown facts lead to review, not automatic rejection. Enter one item per line.</p></header>
    <div className="space-y-5 rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6">
      <label className="block space-y-2 text-sm"><span>Profile name</span><Input value={data.name} onChange={event => setData({ ...data, name: event.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.isActive} onChange={event => setData({ ...data, isActive: event.target.checked })} /> Active ICP</label>
      <label className="block space-y-2 text-sm"><span>Qualification policy</span><select value={data.qualificationPolicy} onChange={event => setData({ ...data, qualificationPolicy: event.target.value as Settings['qualificationPolicy'] })} className="block h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="CONSERVATIVE">Conservative — only explicit exclusions auto-reject</option><option value="BALANCED">Balanced — multiple clear mismatches may reject</option><option value="STRICT">Strict — known target mismatches may reject</option></select></label>
      <div className="grid gap-5 sm:grid-cols-2">{fields.map(field => <label key={field.key} className="block space-y-2 text-sm"><span>{field.label}</span><textarea value={drafts[field.key]} onChange={event => setDrafts({ ...drafts, [field.key]: event.target.value })} rows={3} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>)}</div>
      <div className="grid gap-4 sm:grid-cols-2">{(['companySizeMin', 'companySizeMax'] as const).map(key => <label key={key} className="block space-y-2 text-sm"><span>{key === 'companySizeMin' ? 'Minimum company size' : 'Maximum company size'}</span><Input type="number" min={0} value={data[key] ?? ''} onChange={event => setData({ ...data, [key]: event.target.value === '' ? null : Number(event.target.value) })} /></label>)}</div>
      <Button type="button" onClick={save} disabled={pending} aria-busy={pending}>{pending ? 'Saving...' : 'Save ICP'}</Button>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>
  </div>;
}
