'use client';
import { useEffect, useState } from 'react';
import { MARKET_OPTIONS } from '@/lib/market-messaging-shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import FrameSelect from '@/components/ui/FrameSelect';

type Profile = { id: string; name: string; countries: string[]; formality: string; directness: string; warmth: string;
  openerStyle: string; ctaStyle: string; lengthStyle: string; salutationStyle: string;
  languageGuidance: string | null; additionalGuidance: string | null; enabled: boolean };
type Draft = Omit<Profile, 'id' | 'enabled'> & { id: string; enabled: boolean; countryText: string };
const fresh = (): Draft => ({ id: '', name: '', countries: [], countryText: '', formality: 'MEDIUM', directness: 'MEDIUM',
  warmth: 'MEDIUM', openerStyle: 'CONTEXT_FIRST', ctaStyle: 'PERMISSION_BASED', lengthStyle: 'SHORT',
  salutationStyle: 'FIRST_NAME', languageGuidance: '', additionalGuidance: '', enabled: true });
const labels: Record<string, string> = { formality: 'Formality', directness: 'Directness', warmth: 'Warmth', openerStyle: 'Opener',
  ctaStyle: 'CTA phrasing', lengthStyle: 'Email length', salutationStyle: 'Salutation' };
export default function MarketProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]), [draft, setDraft] = useState<Draft>(fresh());
  const [message, setMessage] = useState(''), [pending, setPending] = useState(false);
  async function reload() {
    const response = await fetch('/api/market-profiles', { cache: 'no-store' });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load market profiles.');
    setProfiles(data.profiles ?? []);
  }
  useEffect(() => { reload().catch(error => setMessage(error.message)); }, []);
  function edit(profile: Profile) { setDraft({ ...profile, countryText: profile.countries.join(', ') }); setMessage(''); }
  async function save() {
    if (pending) return;
    setPending(true); setMessage('');
    const body = { name: draft.name, countries: draft.countryText.split(/[\n,;]/).map(country => country.trim()).filter(Boolean),
      formality: draft.formality, directness: draft.directness, warmth: draft.warmth, openerStyle: draft.openerStyle,
      ctaStyle: draft.ctaStyle, lengthStyle: draft.lengthStyle, salutationStyle: draft.salutationStyle,
      languageGuidance: draft.languageGuidance || null, additionalGuidance: draft.additionalGuidance || null, enabled: draft.enabled };
    try {
      const response = await fetch(draft.id ? `/api/market-profiles/${encodeURIComponent(draft.id)}` : '/api/market-profiles', {
        method: draft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not save market profile.');
      setDraft(fresh()); await reload(); setMessage('Market profile saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save market profile.'); }
    finally { setPending(false); }
  }
  async function remove(id: string) {
    if (pending) return;
    setPending(true); setMessage('');
    try { const response = await fetch(`/api/market-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not delete market profile.');
      if (draft.id === id) setDraft(fresh()); await reload(); setMessage('Market profile deleted.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete market profile.'); }
    finally { setPending(false); }
  }
  async function toggle(profile: Profile) {
    const value = !profile.enabled;
    const body = { name: profile.name, countries: profile.countries, formality: profile.formality,
      directness: profile.directness, warmth: profile.warmth, openerStyle: profile.openerStyle,
      ctaStyle: profile.ctaStyle, lengthStyle: profile.lengthStyle, salutationStyle: profile.salutationStyle,
      languageGuidance: profile.languageGuidance, additionalGuidance: profile.additionalGuidance, enabled: value };
    setPending(true); setMessage('');
    try { const response = await fetch(`/api/market-profiles/${encodeURIComponent(profile.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not update market profile.');
      await reload(); setMessage(value ? 'Market profile enabled.' : 'Market profile disabled.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update market profile.'); }
    finally { setPending(false); }
  }
  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Profiles <span className="ml-2 font-normal text-muted-foreground">{profiles.length}</span></h2>
      <Button type="button" variant="outline" onClick={() => { setDraft(fresh()); setMessage(''); }}>+ New profile</Button></div>
    <div className="flex flex-wrap gap-2" aria-label="Market profile list">
      {profiles.length ? profiles.map(profile => <article key={profile.id} className={`min-w-[220px] flex-1 rounded-lg border p-3 transition-colors ${draft.id === profile.id ? 'border-[#FF5A1F]/60 bg-[#FF5A1F]/5' : 'border-border/50 bg-card/40'}`}>
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{profile.name}</h3><p className="mt-1 truncate text-xs text-muted-foreground">{profile.countries.join(', ') || 'No countries assigned'}</p></div>
          <span className={`shrink-0 text-[10px] uppercase tracking-wide ${profile.enabled ? 'text-emerald-300' : 'text-muted-foreground'}`}>{profile.enabled ? 'Enabled' : 'Disabled'}</span></div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs"><button type="button" aria-label={`Edit ${profile.name}`} className="min-h-8 text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]" onClick={() => edit(profile)}>Edit</button>
          <button type="button" aria-label={`${profile.enabled ? 'Disable' : 'Enable'} ${profile.name}`} disabled={pending} className="min-h-8 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]" onClick={() => toggle(profile)}>{profile.enabled ? 'Disable' : 'Enable'}</button>
          <button type="button" aria-label={`Delete ${profile.name}`} disabled={pending} className="min-h-8 text-red-300 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" onClick={() => remove(profile.id)}>Delete</button></div>
      </article>) : <p className="w-full rounded-lg border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">No custom market profiles yet. Create a profile to define market presentation.</p>}
    </div>
    <div className="space-y-4 rounded-xl border border-border/60 bg-card/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{draft.id ? 'Edit profile' : 'Profile editor'}</h3>{draft.id && <Button type="button" variant="outline" disabled={pending} onClick={() => setDraft(fresh())}>Cancel edit</Button>}</div>
      <div className="grid items-end gap-4 md:grid-cols-2 xl:grid-cols-12">
        <label className="flex min-w-0 flex-col gap-2 text-sm xl:col-span-3"><span className="leading-5">Profile name</span><Input maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="flex min-w-0 flex-col gap-2 text-sm xl:col-span-6"><span className="leading-5">Countries</span><textarea aria-label="Countries, separated by commas or new lines" className="h-10 min-h-10 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm" rows={1} maxLength={1000} value={draft.countryText} onChange={e => setDraft({ ...draft, countryText: e.target.value })} placeholder="Germany, Austria, Switzerland" /></label>
        <label className="flex min-w-0 flex-col gap-2 text-sm xl:col-span-3"><span className="leading-5">Automatic assignment</span><span className="flex h-10 items-center gap-2"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled</span></label>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{(['formality', 'directness', 'warmth'] as const).map(field => <label key={field} className="block text-sm">{labels[field]}<FrameSelect className="mt-1" ariaLabel={labels[field]} value={draft[field]} onValueChange={value => setDraft({ ...draft, [field]: value })} options={MARKET_OPTIONS[field].map(option => ({ value: option, label: option.replaceAll('_', ' ') }))} /></label>)}</div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{(['openerStyle', 'ctaStyle', 'lengthStyle', 'salutationStyle'] as const).map(field => <label key={field} className="block text-sm">{labels[field]}<FrameSelect className="mt-1" ariaLabel={labels[field]} value={draft[field]} onValueChange={value => setDraft({ ...draft, [field]: value })} options={MARKET_OPTIONS[field].map(option => ({ value: option, label: option.replaceAll('_', ' ') }))} /></label>)}</div>
      <div className="grid gap-4 md:grid-cols-2"><label className="block text-sm">Language guidance (optional)<Input className="mt-1" maxLength={120} value={draft.languageGuidance ?? ''} onChange={e => setDraft({ ...draft, languageGuidance: e.target.value })} placeholder="Use English" /></label>
        <label className="block text-sm">Additional presentation guidance (optional)<textarea className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" rows={2} maxLength={500} value={draft.additionalGuidance ?? ''} onChange={e => setDraft({ ...draft, additionalGuidance: e.target.value })} /></label></div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border/50 pt-4"><Button type="button" disabled={pending || !draft.name.trim()} onClick={save}>{pending ? 'Saving…' : draft.id ? 'Save changes' : 'Create profile'}</Button>{message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}</div>
    </div>
  </section>;
}
