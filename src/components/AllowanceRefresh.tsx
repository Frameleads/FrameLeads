'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Refresh server-owned counters after consumption, on focus, and at the verified boundary. */
export default function AllowanceRefresh({ periodEnd }: { periodEnd: string | null }) {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => router.refresh();
    const schedule = () => {
      if (!periodEnd) return;
      const end = Date.parse(periodEnd);
      timer = setTimeout(() => { if (Date.now() >= end) refresh(); else schedule(); },
        Math.min(2147483647, Math.max(1000, end - Date.now() + 1000)));
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('frameleads:usage-changed', refresh);
    schedule();
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('frameleads:usage-changed', refresh); if (timer) clearTimeout(timer); };
  }, [periodEnd, router]);
  return null;
}
