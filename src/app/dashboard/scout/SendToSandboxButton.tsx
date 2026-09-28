'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SendToSandboxButton({ prospectId }: { prospectId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function send() {
    if (pending) return;
    setPending(true); setError('');
    try {
      const response = await fetch('/api/scout/send-to-sandbox', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospectId }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'Could not send this prospect to Sandbox.');
      if (typeof result?.destination !== 'string' || !result.destination.startsWith('/dashboard/sandbox?lead=')) {
        throw new Error('Sandbox destination was unavailable.');
      }
      router.push(result.destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send this prospect to Sandbox.');
      setPending(false);
    }
  }

  return <div className="w-full sm:w-auto">
    <Button type="button" size="sm" className="w-full sm:w-auto" onClick={send} disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />}
      {pending ? 'Opening Sandbox...' : 'Send to Sandbox'}
    </Button>
    {error && <p role="alert" className="mt-2 max-w-xs text-xs text-red-300">{error}</p>}
    <span className="sr-only" aria-live="polite">{pending ? 'Opening Sandbox for this prospect' : ''}</span>
  </div>;
}
