'use client';
import { useEffect, useState } from 'react';
import { MARKET_OPTIONS } from '@/lib/market-messaging-shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  return <section className="space-y-4 rounded-xl border border-border/60 bg-card/50 p-5">
    <div><h2 className="text-sm font-semibold">Market messaging profiles</h2>
      <p className="mt-2 text-xs text-muted-foreground">Market profiles adjust communication style and structure. Outreach permission and legal requirements remain governed separately by the Sales Constitution.</p></div>
    <div className="space-y-2">{profiles.map(profile => <div key={profile.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
      <div><p className="text-sm font-medium">{profile.name} <span className="text-xs text-muted-foreground">{profile.enabled ? 'Enabled' : 'Disabled'}</span></p>
        <p className="text-xs text-muted-foreground">{profile.countries.join(', ')}</p></div>
      <div className="flex gap-3 text-xs"><button type="button" className="underline" onClick={() => edit(profile)}>Edit</button>
        <button type="button" disabled={pending} className="underline" onClick={() => toggle(profile)}>{profile.enabled ? 'Disable' : 'Enable'}</button>
        <button type="button" disabled={pending} className="text-red-300 underline" onClick={() => remove(profile.id)}>Delete</button></div>
    </div>)}</div>
    <div className="space-y-3 border-t border-border/50 pt-4"><h3 className="text-sm font-medium">{draft.id ? 'Edit profile' : 'Add custom profile'}</h3>
      <label className="block text-xs">Profile name<Input className="mt-1" maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="block text-xs">Countries, separated by commas or new lines<textarea className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" rows={2} maxLength={1000} value={draft.countryText} onChange={e => setDraft({ ...draft, countryText: e.target.value })} placeholder="Germany, Austria, Switzerland" /></label>
      <div className="grid gap-3 sm:grid-cols-2">{(Object.keys(MARKET_OPTIONS) as (keyof typeof MARKET_OPTIONS)[]).map(field => <label key={field} className="text-xs">{labels[field]}<select className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3" value={draft[field]}
        onChange={e => setDraft({ ...draft, [field]: e.target.value })}>{MARKET_OPTIONS[field].map(option => <option key={option}>{option}</option>)}</select></label>)}</div>
      <label className="block text-xs">Language guidance (optional)<Input className="mt-1" maxLength={120} value={draft.languageGuidance ?? ''} onChange={e => setDraft({ ...draft, languageGuidance: e.target.value })} placeholder="Use English" /></label>
      <label className="block text-xs">Additional presentation guidance (optional)<textarea className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" rows={2} maxLength={500} value={draft.additionalGuidance ?? ''} onChange={e => setDraft({ ...draft, additionalGuidance: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled for automatic country assignment</label>
      <div className="flex gap-2"><Button type="button" disabled={pending || !draft.name.trim()} onClick={save}>{pending ? 'Saving…' : draft.id ? 'Save changes' : 'Create profile'}</Button>
        {draft.id && <Button type="button" variant="outline" disabled={pending} onClick={() => setDraft(fresh())}>Cancel</Button>}</div>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>
  </section>;
}
