'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function QualifyButton({ prospectId }: { prospectId?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function run() {
    if (pending) return;
    setPending(true); setMessage('');
    try {
      let cursor: string | null = null;
      let processed = 0;
      do {
        const response: Response = await fetch('/api/scout/qualify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prospectId ? { prospectId } : cursor ? { cursor } : {}) });
        const result: { error?: string; result?: { processed?: number; nextCursor?: string | null } } = await response.json();
        if (!response.ok) throw new Error(result.error || 'Qualification failed.');
        processed += result.result?.processed ?? 1;
        cursor = prospectId ? null : result.result?.nextCursor ?? null;
        if (cursor) setMessage(`Qualified ${processed} prospects...`);
      } while (cursor);
      router.refresh();
      if (!prospectId) setMessage(`Qualified ${processed} prospects.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Qualification failed.'); }
    finally { setPending(false); }
  }
  return <span className="inline-flex flex-col items-start gap-1"><Button type="button" size="sm" variant="outline" disabled={pending} aria-busy={pending} onClick={run}>{pending ? 'Qualifying...' : prospectId ? 'Qualify Prospect' : 'Qualify Prospects'}</Button>{message && <span role="status" className="text-xs text-muted-foreground">{message}</span>}</span>;
}
