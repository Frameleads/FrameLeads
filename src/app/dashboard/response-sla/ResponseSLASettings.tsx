'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Policy = { enabled: boolean; criticalMinutes: number; highMinutes: number; mediumMinutes: number;
  lowMinutes: number; unknownMinutes: number; dueSoonPercent: number; breachEscalationEnabled: boolean };
const durations = [
  { key: 'criticalMinutes', label: 'Critical' }, { key: 'highMinutes', label: 'High' },
  { key: 'mediumMinutes', label: 'Medium' }, { key: 'lowMinutes', label: 'Low' },
  { key: 'unknownMinutes', label: 'Unknown risk' },
] as const;

export default function ResponseSLASettings() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    fetch('/api/response-sla/settings').then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setPolicy(data.policy)).catch(() => setMessage('SLA settings could not load.'))
      .finally(() => setLoading(false));
  }, []);
  async function save() {
    if (!policy) return;
    setSaving(true); setMessage('');
    try {
      const response = await fetch('/api/response-sla/settings', { method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(policy) });
      if (!response.ok) throw new Error();
      setMessage('Response SLA settings saved. Existing deadlines remain unchanged.');
    } catch { setMessage('SLA settings could not be saved. Check the minute limits.'); }
    finally { setSaving(false); }
  }
  return <main className="min-h-screen bg-[#0D0D0D] text-[#F5F1E8]">
    <div className="mx-auto w-full max-w-[1680px] space-y-6 px-1 sm:px-0">
      <Link href="/dashboard/inbox-triage" className="text-sm text-[#FF5A1F] underline">Back to Inbox</Link>
      <div><h1 className="text-2xl font-semibold">Response SLA settings</h1>
        <p className="mt-1 text-sm text-gray-400">Elapsed wall-clock deadlines for human-owned revenue replies.</p></div>
      {loading && <p role="status">Loading settings...</p>}
      {message && <p role="status" className="text-sm text-amber-300">{message}</p>}
      {policy && <section className="w-full min-w-0 max-w-full rounded-lg border border-[#333] bg-[#121212]">
        <div className="w-full min-w-0 max-w-full space-y-5 p-5"><div className="grid w-full min-w-0 max-w-full gap-4 xl:grid-cols-12"><div className="w-full min-w-0 max-w-full space-y-3 rounded-lg border border-[#333] bg-black/20 p-4 xl:col-span-4"><h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Global controls</h2>
        <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" checked={policy.enabled}
          onChange={event => setPolicy({ ...policy, enabled: event.target.checked })} /> Enable response SLAs</label>
        <p className="text-xs text-gray-400">Turning this off cancels unresolved SLAs when next refreshed; cancelled history remains.</p>
        <label className="block text-sm">Due-soon threshold (% elapsed)
          <input type="number" min={50} max={95} value={policy.dueSoonPercent}
            onChange={event => setPolicy({ ...policy, dueSoonPercent: Number(event.target.value) })}
            className="mt-1 block w-full min-w-0 max-w-full rounded border border-[#444] bg-[#181818] p-2 text-white" /></label>
        <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" checked={policy.breachEscalationEnabled}
          onChange={event => setPolicy({ ...policy, breachEscalationEnabled: event.target.checked })} /> Route first breach to human review</label>
        </div><div className="w-full min-w-0 max-w-full space-y-3 rounded-lg border border-[#333] bg-black/20 p-4 xl:col-span-8"><h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Risk-band durations</h2><div className="grid w-full min-w-0 max-w-full gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{durations.map(item => <label key={item.key} className="block text-sm">{item.label} (minutes)
          <input type="number" min={1} max={10080} value={policy[item.key]}
            onChange={event => setPolicy({ ...policy, [item.key]: Number(event.target.value) })}
            className="mt-1 block w-full min-w-0 max-w-full rounded border border-[#444] bg-[#181818] p-2 text-white" /></label>)}</div></div></div>
        <div className="flex flex-wrap items-center gap-4 border-t border-[#333] pt-4"><button type="button" disabled={saving} onClick={() => void save()}
          className="min-h-11 w-full rounded bg-[#FF5A1F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:min-h-0 sm:w-auto">{saving ? 'Saving...' : 'Save settings'}</button>
        </div>
      </div></section>}
    </div>
  </main>;
}
