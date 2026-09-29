'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import FrameSelect from '@/components/ui/FrameSelect';

type Mode = 'AUTOPILOT' | 'HUMAN_APPROVAL' | 'MANDATORY_ESCALATION';
type Policy = { defaultMode: Mode; fallbackMode: 'HUMAN_APPROVAL' | 'MANDATORY_ESCALATION';
  autopilotEnabled: boolean; autoExecutionDisabled: boolean; autopilotMinConfidence: number;
  maxAutoSendsPerDay: number };
type List = { id: string; name: string };
type Override = { leadListId: string; mode: string };
const modes: Mode[] = ['HUMAN_APPROVAL','MANDATORY_ESCALATION','AUTOPILOT'];

export default function AutomationSettings() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    fetch('/api/automation/settings').then(response => response.ok ? response.json() : Promise.reject())
      .then(data => { setPolicy(data.policy); setLists(data.lists); setOverrides(data.overrides); })
      .catch(() => setMessage('Automation settings could not load.'))
      .finally(() => setLoading(false));
  }, []);
  async function save() {
    if (!policy) return;
    setSaving(true); setMessage('');
    try {
      const response = await fetch('/api/automation/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultMode: policy.defaultMode, fallbackMode: policy.fallbackMode,
          autopilotEnabled: policy.autopilotEnabled, autoExecutionDisabled: policy.autoExecutionDisabled,
          autopilotMinConfidence: policy.autopilotMinConfidence, maxAutoSendsPerDay: policy.maxAutoSendsPerDay }) });
      if (!response.ok) throw new Error();
      setMessage('Automation settings saved. Automatic sending also requires the server rollout control.');
    } catch { setMessage('Automation settings could not be saved.'); }
    finally { setSaving(false); }
  }
  async function setOverride(leadListId: string, mode: string) {
    setMessage('');
    const response = await fetch('/api/automation/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadListId, mode }) });
    if (response.ok) { setOverrides(current => [...current.filter(row => row.leadListId !== leadListId), { leadListId, mode }]);
      setMessage('Lead-list override saved.'); }
    else setMessage('Lead-list override could not be saved.');
  }
  return <main className="min-h-screen bg-[#0D0D0D] text-[#F5F1E8]">
    <div className="mx-auto w-full max-w-[1680px] space-y-6 px-1 sm:px-0">
      <Link href="/dashboard/inbox-triage" className="text-sm text-[#FF5A1F] underline">Back to Inbox</Link>
      <div><h1 className="text-2xl font-semibold">Automation settings</h1>
        <p className="mt-1 text-sm text-gray-400">Governed reply execution. Automatic sending is disabled by default.</p></div>
      {loading && <p role="status">Loading settings…</p>}
      {message && <p role="status" className="text-sm text-amber-300">{message}</p>}
      {policy && <section className="w-full min-w-0 max-w-full rounded-lg border border-[#333] bg-[#121212]">
        <div className="grid w-full min-w-0 max-w-full gap-4 p-6 md:grid-cols-2 md:px-8 md:py-7 xl:px-10">
        <label className="block w-full min-w-0 max-w-full text-sm">Default mode
          <FrameSelect className="mt-2 w-full max-w-full" ariaLabel="Default mode" value={policy.defaultMode} onValueChange={value => setPolicy({ ...policy, defaultMode: value as Mode })}
            options={modes.map(mode => ({ value: mode, label: mode.replaceAll('_', ' ') }))} /></label>
        <label className="block w-full min-w-0 max-w-full text-sm">Safe fallback
          <FrameSelect className="mt-2 w-full max-w-full" ariaLabel="Safe fallback" value={policy.fallbackMode} onValueChange={value => setPolicy({ ...policy, fallbackMode: value as Policy['fallbackMode'] })}
            options={[{ value: 'HUMAN_APPROVAL', label: 'Human approval' }, { value: 'MANDATORY_ESCALATION', label: 'Mandatory escalation' }]} /></label>
        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[#333] bg-black/20 px-3 text-sm md:col-span-2"><input type="checkbox" checked={policy.autopilotEnabled}
          onChange={event => setPolicy({ ...policy, autopilotEnabled: event.target.checked })} /> Permit tenant Autopilot</label>
        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[#333] bg-black/20 px-3 text-sm md:col-span-2"><input type="checkbox" checked={policy.autoExecutionDisabled}
          onChange={event => setPolicy({ ...policy, autoExecutionDisabled: event.target.checked })} /> Global auto-execution kill switch</label>
        <label className="block w-full min-w-0 max-w-full text-sm">Minimum Autopilot confidence (70–100)
          <input type="number" min={70} max={100} value={policy.autopilotMinConfidence}
            onChange={event => setPolicy({ ...policy, autopilotMinConfidence: Number(event.target.value) })}
            className="mt-2 block w-full min-w-0 max-w-full rounded border border-[#444] bg-[#181818] p-2 text-white" /></label>
        <label className="block w-full min-w-0 max-w-full text-sm">Maximum automatic sends per rolling day (1–100)
          <input type="number" min={1} max={100} value={policy.maxAutoSendsPerDay}
            onChange={event => setPolicy({ ...policy, maxAutoSendsPerDay: Number(event.target.value) })}
            className="mt-2 block w-full min-w-0 max-w-full rounded border border-[#444] bg-[#181818] p-2 text-white" /></label>
        <button type="button" disabled={saving} onClick={() => void save()}
          className="min-h-11 w-full rounded bg-[#FF5A1F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:min-h-0 sm:w-auto">{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      </section>}
      {lists.length > 0 && <section className="w-full min-w-0 max-w-full rounded-lg border border-[#333] bg-[#121212]">
        <div className="space-y-3 p-6 md:px-8 md:py-7 xl:px-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Lead-list overrides</h2>
        <p className="text-xs text-gray-400">Lead lists are the existing tenant-owned campaign grouping. External campaign IDs are not used here.</p>
        <div className="grid gap-2 md:grid-cols-2">{lists.map(list => <label key={list.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded border border-[#333] bg-black/20 p-3 text-sm">
          <span>{list.name}</span><FrameSelect className="w-full sm:w-64" ariaLabel={`${list.name} automation override`} value={overrides.find(row => row.leadListId === list.id)?.mode ?? 'INHERIT'}
            onValueChange={value => void setOverride(list.id, value)}
            options={['INHERIT','HUMAN_APPROVAL','MANDATORY_ESCALATION','AUTOPILOT','DISABLE_AUTOMATION'].map(mode => ({ value: mode, label: mode.replaceAll('_', ' ') }))} /></label>)}</div>
        </div>
      </section>}
    </div>
  </main>;
}
