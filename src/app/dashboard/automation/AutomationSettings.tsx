'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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
  return <main className="min-h-screen bg-[#0D0D0D] p-5 text-[#F5F1E8] md:p-8">
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard/inbox-triage" className="text-sm text-[#FF5A1F] underline">Back to Inbox</Link>
      <div><h1 className="text-2xl font-semibold">Automation settings</h1>
        <p className="mt-1 text-sm text-gray-400">Governed reply execution. Automatic sending is disabled by default.</p></div>
      {loading && <p role="status">Loading settings…</p>}
      {message && <p role="status" className="text-sm text-amber-300">{message}</p>}
      {policy && <section className="space-y-5 rounded-lg border border-[#333] bg-[#121212] p-5">
        <label className="block text-sm">Default mode
          <select value={policy.defaultMode} onChange={event => setPolicy({ ...policy, defaultMode: event.target.value as Mode })}
            className="mt-2 block w-full rounded border border-[#444] bg-[#181818] p-2 text-white">
            {modes.map(mode => <option key={mode} value={mode}>{mode.replaceAll('_', ' ')}</option>)}
          </select></label>
        <label className="block text-sm">Safe fallback
          <select value={policy.fallbackMode} onChange={event => setPolicy({ ...policy, fallbackMode: event.target.value as Policy['fallbackMode'] })}
            className="mt-2 block w-full rounded border border-[#444] bg-[#181818] p-2 text-white">
            <option value="HUMAN_APPROVAL">Human approval</option><option value="MANDATORY_ESCALATION">Mandatory escalation</option>
          </select></label>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={policy.autopilotEnabled}
          onChange={event => setPolicy({ ...policy, autopilotEnabled: event.target.checked })} /> Permit tenant Autopilot</label>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={policy.autoExecutionDisabled}
          onChange={event => setPolicy({ ...policy, autoExecutionDisabled: event.target.checked })} /> Global auto-execution kill switch</label>
        <label className="block text-sm">Minimum Autopilot confidence (70–100)
          <input type="number" min={70} max={100} value={policy.autopilotMinConfidence}
            onChange={event => setPolicy({ ...policy, autopilotMinConfidence: Number(event.target.value) })}
            className="mt-2 block w-full rounded border border-[#444] bg-[#181818] p-2 text-white" /></label>
        <label className="block text-sm">Maximum automatic sends per rolling day (1–100)
          <input type="number" min={1} max={100} value={policy.maxAutoSendsPerDay}
            onChange={event => setPolicy({ ...policy, maxAutoSendsPerDay: Number(event.target.value) })}
            className="mt-2 block w-full rounded border border-[#444] bg-[#181818] p-2 text-white" /></label>
        <button type="button" disabled={saving} onClick={() => void save()}
          className="rounded bg-[#FF5A1F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save settings'}</button>
      </section>}
      {lists.length > 0 && <section className="space-y-3 rounded-lg border border-[#333] bg-[#121212] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Lead-list overrides</h2>
        <p className="text-xs text-gray-400">Lead lists are the existing tenant-owned campaign grouping. External campaign IDs are not used here.</p>
        {lists.map(list => <label key={list.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{list.name}</span><select value={overrides.find(row => row.leadListId === list.id)?.mode ?? 'INHERIT'}
            onChange={event => void setOverride(list.id, event.target.value)}
            className="rounded border border-[#444] bg-[#181818] p-2 text-white">
            {['INHERIT','HUMAN_APPROVAL','MANDATORY_ESCALATION','AUTOPILOT','DISABLE_AUTOMATION'].map(mode =>
              <option key={mode} value={mode}>{mode.replaceAll('_', ' ')}</option>)}</select></label>)}
      </section>}
    </div>
  </main>;
}
