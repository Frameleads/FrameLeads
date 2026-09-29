'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, BrainCircuit, Globe2, Radar, Search, Target } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { ScoutProspectRow } from '@/lib/scout-data';
import { qualificationLabel, scoutPrimaryAction, scoutStatus, whyNowSummary } from '@/lib/scout-view';
import ResearchButton from './ResearchButton';
import QualifyButton from './QualifyButton';

type Filter = 'all' | 'strong' | 'review' | 'unresearched';
const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'strong', label: 'Strong Fit' },
  { id: 'review', label: 'Needs Review' }, { id: 'unresearched', label: 'Not Researched' },
];

function StatusPill({ status }: { status: ScoutProspectRow['researchStatus'] }) {
  const view = scoutStatus(status);
  return <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${view.tone}`}>
    {view.busy && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />}{view.label}
  </span>;
}

function ProspectAction({ prospect, compact = false }: { prospect: ScoutProspectRow; compact?: boolean }) {
  const action = scoutPrimaryAction(prospect.researchStatus);
  if (prospect.qualificationOverride === 'USER_EXCLUDED') return <Link href={`/dashboard/scout/${encodeURIComponent(prospect.id)}`} className="text-xs font-medium text-primary hover:underline">Review decision</Link>;
  if (prospect.qualificationPolicyVersion < 1) return <QualifyButton prospectId={prospect.id} />;
  if (action !== 'view' && prospect.qualificationStatus !== 'QUALIFIED' && action !== 'busy') return <QualifyButton prospectId={prospect.id} />;
  if (action === 'view') return (
    <div className={compact ? 'flex flex-wrap items-center gap-2' : 'flex flex-col items-start gap-2'}>
      <Link href={`/dashboard/scout/${encodeURIComponent(prospect.id)}`}
        className="inline-flex h-11 items-center justify-center rounded-lg bg-primary sm:h-9 px-3 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        View Intelligence
      </Link>
      {prospect.qualificationStatus === 'QUALIFIED' ? <ResearchButton prospectId={prospect.id} status={prospect.researchStatus} forceRefresh /> : <QualifyButton prospectId={prospect.id} />}
    </div>
  );
  return <ResearchButton prospectId={prospect.id} status={prospect.researchStatus} compact={compact} />;
}

export default function ScoutWorkspace({ prospects }: { prospects: ScoutProspectRow[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return prospects.filter(item => {
      if (filter === 'strong' && item.fitTier !== 'STRONG') return false;
      if (filter === 'review' && item.researchStatus !== 'NEEDS_REVIEW') return false;
      if (filter === 'unresearched' && item.researchStatus !== 'NOT_RESEARCHED') return false;
      return !search || item.name.toLocaleLowerCase().includes(search) || item.companyName.toLocaleLowerCase().includes(search);
    });
  }, [prospects, query, filter]);

  return <div className="mx-auto w-full max-w-[1680px] space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary"><Radar className="h-4 w-4" aria-hidden="true" /> Decision intelligence</div>
        <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">Scout</h1>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">Review prospect fit, timing, risks, and the evidence behind each assessment.</p>
      </div>
      <div className="flex w-[180px] shrink-0 flex-col items-stretch gap-3">
        <div className="w-full rounded-xl border border-border/50 bg-card/50 px-4 py-2 text-left">
          <div className="text-xl font-semibold tabular-nums">{prospects.length}</div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Prospects</div>
        </div>
        <div className="w-full [&>span]:w-full [&_button]:w-full"><QualifyButton /></div>
      </div>
    </header>

    <nav aria-label="Scout intelligence configuration" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[
        { href: '/dashboard/scout/settings', label: 'ICP Profile', detail: 'Defines who qualifies', icon: Target },
        { href: '/dashboard/brain', label: 'FrameLeads Brain', detail: 'Company knowledge and communication context', icon: BrainCircuit },
        { href: '/dashboard/market-profiles', label: 'Market Profiles', detail: 'Adapts email presentation by market', icon: Globe2 },
      ].map(item => <Link key={item.href} href={item.href} className="group flex min-h-[76px] items-center gap-3 rounded-xl border border-border/60 bg-card/35 px-4 py-3 transition-colors duration-150 hover:border-[#FF5A1F]/50 hover:bg-[#1A1A1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-[#1A1A1A] text-muted-foreground transition-colors group-hover:text-[#FF5A1F]"><item.icon className="h-5 w-5" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-foreground">{item.label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span></span>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[#FF5A1F]" aria-hidden="true" />
      </Link>)}
    </nav>

    {prospects.length === 0 ? <div className="grid gap-6 rounded-2xl border border-dashed border-border bg-card/30 p-6 sm:p-8 lg:grid-cols-5 lg:items-center">
      <div className="lg:col-span-2"><div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border/60 bg-[#1A1A1A] text-[#FF5A1F]"><Radar className="h-5 w-5" aria-hidden="true" /></div>
        <h2 className="mt-4 text-lg font-semibold">No prospects to research yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">Prospects appear here after leads enter FrameLeads.</p>
        <Link href="/dashboard/ingestion" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Go to Ingestion <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link>
      </div>
      <div className="border-t border-border/50 pt-5 lg:col-span-3 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Scout evaluates</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[['Fit', 'ICP and company alignment'], ['Timing', 'Available buying signals'], ['Risks', 'Evidence gaps and concerns'], ['Evidence', 'Sources behind analysis']].map(([label, detail]) => <div key={label} className="rounded-lg border border-border/50 bg-background/40 px-3 py-2.5"><p className="text-sm font-medium">{label}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>)}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span>ICP</span><ArrowRight className="h-3 w-3" /><span>Research</span><ArrowRight className="h-3 w-3" /><span>Route</span></div>
      </div>
    </div> : <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or company" aria-label="Search prospects by name or company" className="pl-9" /></div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter prospects">
          {filters.map(option => <button key={option.id} type="button" onClick={() => setFilter(option.id)} aria-pressed={filter === option.id}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filter === option.id ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border/60 bg-card/40 text-muted-foreground hover:text-foreground'}`}>
            {option.label}
          </button>)}
        </div>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">Showing {visible.length} of {prospects.length} prospects</p>
      {visible.length === 0 ? <div className="rounded-2xl border border-border/60 bg-card/40 px-6 py-12 text-center text-sm text-muted-foreground">No prospects match this search or filter.</div> : <>
        <div className="hidden overflow-hidden w-full min-w-0 rounded-2xl border border-border/60 bg-card/40 xl:block">
          <div className="grid grid-cols-[minmax(130px,1.3fr)_minmax(110px,1fr)_72px_85px_minmax(120px,1.2fr)_115px_215px] gap-3 border-b border-border/60 bg-muted/20 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Prospect</span><span>Company</span><span>Fit</span><span>Value</span><span>Why now</span><span>Research</span><span>Action</span>
          </div>
          {visible.map(item => <div key={item.id} className="grid grid-cols-[minmax(130px,1.3fr)_minmax(110px,1fr)_72px_85px_minmax(120px,1.2fr)_115px_215px] items-center gap-3 border-b border-border/40 px-5 py-4 text-sm last:border-b-0 hover:bg-muted/20">
            <Link href={`/dashboard/scout/${encodeURIComponent(item.id)}`} className="min-w-0 truncate font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.name}</Link>
            <span className="min-w-0 truncate text-muted-foreground">{item.companyName}<span className="block text-[11px] text-muted-foreground/80">{qualificationLabel(item.qualificationStatus, item.qualificationReasonCode, item.qualificationOverride, item.qualificationPolicyVersion)}</span></span>
            <span className="font-semibold tabular-nums">{item.fitScore === null ? '—' : item.fitScore}</span>
            <span className="text-xs text-muted-foreground">{item.potentialValueBand || '—'}</span>
            <span className="line-clamp-2 text-xs leading-5 text-muted-foreground">{whyNowSummary(item.whyNow)}</span>
            <StatusPill status={item.researchStatus} />
            <ProspectAction prospect={item} />
          </div>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:hidden">
          {visible.map(item => <article key={item.id} className="min-w-0 rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><Link href={`/dashboard/scout/${encodeURIComponent(item.id)}`} className="text-base font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.name}</Link><p className="mt-1 truncate text-sm text-muted-foreground">{item.companyName}</p><p className="mt-1 text-xs text-muted-foreground">{qualificationLabel(item.qualificationStatus, item.qualificationReasonCode, item.qualificationOverride, item.qualificationPolicyVersion)}</p></div>
              <span className="shrink-0 text-lg font-semibold tabular-nums">{item.fitScore === null ? '—' : item.fitScore}<span className="ml-0.5 text-xs font-normal text-muted-foreground">{item.fitScore === null ? '' : '/100'}</span></span>
            </div>
            <div className="mt-4"><StatusPill status={item.researchStatus} /></div>
            <p className="mt-4 min-h-10 text-sm leading-5 text-muted-foreground">{whyNowSummary(item.whyNow)}</p>
            <div className="mt-4 border-t border-border/50 pt-4"><ProspectAction prospect={item} compact /></div>
          </article>)}
        </div>
      </>}
    </>}
  </div>;
}
