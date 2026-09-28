'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScoutStatus } from '@/lib/scout-view';

export default function ResearchButton({
  prospectId, status, forceRefresh = false, compact = false,
}: {
  prospectId: string;
  status: ScoutStatus;
  forceRefresh?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState('');

  useEffect(() => {
    if (status !== 'RESEARCHING') return;
    const interval = window.setInterval(() => startTransition(() => router.refresh()), 7_000);
    return () => window.clearInterval(interval);
  }, [status, router]);

  const busy = submitting || refreshing || status === 'RESEARCHING';
  const label = busy ? 'Researching prospect...' : forceRefresh ? 'Research Again' : status === 'FAILED' ? 'Retry Research' : 'Research Prospect';

  async function runResearch() {
    if (busy) return;
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/scout/research', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospectId, forceRefresh }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'Research could not be started. Please retry.');
      if (result?.status === 'NOT_ELIGIBLE' || result?.status === 'QUALIFICATION_REQUIRED') {
        setError(result?.warnings?.[0] || 'Qualify this prospect before research.');
      }
      if (result?.status === 'FAILED') setError('Research failed. Please retry.');
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Research could not be started. Please retry.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-w-0">
      <Button type="button" size="sm" variant={forceRefresh ? 'outline' : 'default'}
        className={compact ? 'w-full' : undefined} disabled={busy} onClick={runResearch} aria-busy={busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : forceRefresh ? <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> : <Search className="mr-2 h-4 w-4" aria-hidden="true" />}
        {label}
      </Button>
      {error && <p role="alert" className="mt-2 max-w-xs text-xs text-red-300">{error}</p>}
      <span className="sr-only" aria-live="polite">{busy ? 'Researching prospect' : ''}</span>
    </div>
  );
}
