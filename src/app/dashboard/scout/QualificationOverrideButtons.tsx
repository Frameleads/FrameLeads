'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

type Decision = 'AUTO' | 'USER_QUALIFIED' | 'USER_EXCLUDED';
export default function QualificationOverrideButtons({ prospectId, current }: { prospectId: string; current: Decision }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function choose(override: Decision) {
    if (pending) return;
    setPending(true); setError('');
    try {
      const response = await fetch('/api/scout/qualification-override', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prospectId, override }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save this decision.');
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this decision.'); }
    finally { setPending(false); }
  }
  return <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant={current === 'USER_QUALIFIED' ? 'default' : 'outline'} disabled={pending || current === 'USER_QUALIFIED'} onClick={() => choose('USER_QUALIFIED')}>Keep / Qualify</Button><Button type="button" size="sm" variant="outline" disabled={pending || current === 'USER_EXCLUDED'} onClick={() => choose('USER_EXCLUDED')}>Exclude</Button>{current !== 'AUTO' && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => choose('AUTO')}>Use ICP rules</Button>}{error && <span role="alert" className="text-xs text-red-300">{error}</span>}</div>;
}
