'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, BrainCircuit, Globe2, Radar, Search, Target } from 'lucide-react';
import { Input } from '@/components/ui/input';
import SetupNotice from '@/components/SetupNotice';
import type { ScoutProspectRow } from '@/lib/scout-data';
import { fitSummary, qualificationStatus, researchStatusDetail, scoutPrimaryAction, scoutStatus, valueSummary, whyNowSummary } from '@/lib/scout-view';
import ResearchButton from './ResearchButton';
import QualifyButton from './QualifyButton';

type Filter = 'all' | 'strong' | 'review' | 'unresearched';
const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'strong', label: 'Strong Fit' },
  { id: 'review', label: 'Needs Review' }, { id: 'unresearched', label: 'Not Researched' },
];

function StatusPill({ prospect }: { prospect: ScoutProspectRow }) {
  const view = scoutStatus(prospect.researchStatus);
  const detail = researchStatusDetail(prospect.researchStatus, prospect.qualificationStatus);
  return <span className="block min-w-0">
    <span title={detail || undefined} className={`inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${view.tone}`}>
      {view.busy && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />}{view.label}
    </span>
    {detail && <span className="mt-1.5 block line-clamp-2 break-words text-[11px] leading-4 text-muted-foreground">{detail}</span>}
  </span>;
}

function QualificationPill({ prospect }: { prospect: ScoutProspectRow }) {
  const view = qualificationStatus(prospect.qualificationStatus, prospect.qualificationReasonCode, prospect.qualificationOverride, prospect.qualificationPolicyVersion);
  return <span className="block min-w-0">
    <span title={view.detail || undefined} className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${view.tone}`}><span className="truncate">{view.label}</span></span>
    {view.detail && <span className="mt-1.5 block line-clamp-2 break-words text-[11px] leading-4 text-muted-foreground">{view.detail}</span>}
  </span>;
}

function FitDisplay({ prospect }: { prospect: ScoutProspectRow }) {
  const view = fitSummary(prospect.fitScore, prospect.fitTier, prospect.researchStatus);
  return <span className={`block font-semibold tabular-nums ${view.tone}`}>
    {view.label}
    {view.detail && prospect.fitScore !== null && <span className="mt-0.5 block text-[10px] font-normal capitalize text-muted-foreground">{view.detail}</span>}
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

export default function ScoutWorkspace({ prospects, profileState = 'ready' }: { prospects: ScoutProspectRow[]; profileState?: 'missing' | 'inactive' | 'incomplete' | 'ready' }) {
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
  const unassessed = prospects.filter(item => item.qualificationStatus === 'UNASSESSED').length;
  const awaitingResearch = prospects.filter(item => item.qualificationStatus === 'QUALIFIED' && item.researchStatus === 'NOT_RESEARCHED').length;
  const evidenceReview = prospects.filter(item => item.researchStatus === 'NEEDS_REVIEW' || item.researchStatus === 'FAILED').length;

  return <div className="mx-auto w-full min-w-0 max-w-[1680px] space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-full">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary"><Radar className="h-4 w-4" aria-hidden="true" /> Decision intelligence</div>
        <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">Scout</h1>
        <p className="mt-1 max-w-2xl break-words text-sm leading-5 text-muted-foreground">Review prospect fit, timing, risks, and the evidence behind each assessment.</p>
      </div>
      <div className="flex w-[180px] shrink-0 flex-col items-stretch gap-3">
        <div className="w-full rounded-xl border border-border/50 bg-card/50 px-4 py-2 text-left">
          <div className="text-xl font-semibold tabular-nums">{prospects.length}</div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Prospects</div>
        </div>
        <div id="scout-qualification" className="w-full [&>span]:w-full [&_button]:w-full"><QualifyButton /></div>
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

    {profileState !== 'ready' ? <SetupNotice level="REQUIRED" title={profileState === 'missing' ? 'No ICP Profile yet' : profileState === 'inactive' ? 'ICP Profile is inactive' : 'ICP criteria are incomplete'} href="/dashboard/scout/settings" linkLabel="Set up ICP Profile" tone="warning">
      {profileState === 'missing' ? 'Scout cannot assess fit until you create an ICP Profile. This is separate from missing prospect details.' : profileState === 'inactive' ? 'Your saved ICP Profile is turned off, so it cannot qualify prospects. Activate it to assess fit.' : 'The active profile has no qualification rules. Add at least one target or exclusion criterion before qualification.'}
    </SetupNotice> : unassessed > 0 ? <SetupNotice level="RECOMMENDED" title={`${unassessed} prospect${unassessed === 1 ? '' : 's'} not qualified yet`} href="#scout-qualification" linkLabel="Go to qualification">
      Qualification has not been run for these prospects. Fit and value are not assessed until the deterministic ICP check runs; missing prospect metadata may still leave a result for review.
    </SetupNotice> : awaitingResearch > 0 ? <SetupNotice level="RECOMMENDED" title={`${awaitingResearch} qualified prospect${awaitingResearch === 1 ? '' : 's'} awaiting research`} href="#scout-prospects" linkLabel="Review eligible prospects">
      Qualification alone does not provide verified timing, fit evidence, or potential value. Run research on eligible prospects to generate those signals.
    </SetupNotice> : evidenceReview > 0 ? <SetupNotice level="RECOMMENDED" title={`${evidenceReview} prospect${evidenceReview === 1 ? '' : 's'} need evidence review`} href="#scout-prospects" linkLabel="Review evidence">
      These assessments have insufficient verified evidence or a research failure. Their status remains under review; no score or timing signal is inferred.
    </SetupNotice> : null}

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
      <p id="scout-prospects" className="text-xs text-muted-foreground" aria-live="polite">Showing {visible.length} of {prospects.length} prospects</p>
      {visible.length === 0 ? <div className="rounded-2xl border border-border/60 bg-card/40 px-6 py-12 text-center text-sm text-muted-foreground">No prospects match this search or filter.</div> : <>
        <div className="hidden w-full min-w-0 overflow-x-auto rounded-2xl border border-border/60 bg-card/40 xl:block" role="region" aria-label="Scout prospect table" tabIndex={0}>
          <div className="min-w-[1320px]">
          <div className="grid grid-cols-[minmax(170px,1.15fr)_minmax(195px,1.25fr)_minmax(118px,0.8fr)_minmax(132px,0.9fr)_minmax(190px,1.25fr)_minmax(152px,1fr)_minmax(182px,1fr)] gap-x-5 border-b border-border/60 bg-muted/20 px-6 py-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Prospect</span><span>Company</span><span>Fit</span><span>Value</span><span>Why now</span><span>Research</span><span>Action</span>
          </div>
          {visible.map(item => <div key={item.id} className="grid grid-cols-[minmax(170px,1.15fr)_minmax(195px,1.25fr)_minmax(118px,0.8fr)_minmax(132px,0.9fr)_minmax(190px,1.25fr)_minmax(152px,1fr)_minmax(182px,1fr)] min-h-[112px] items-center gap-x-5 border-b border-border/40 px-6 py-5 text-[13px] leading-5 last:border-b-0 hover:bg-muted/20">
            <Link href={`/dashboard/scout/${encodeURIComponent(item.id)}`} title={item.name} className="min-w-0 truncate text-sm font-semibold leading-5 text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.name}</Link>
            <span className="min-w-0 text-muted-foreground"><span title={item.companyName} className="block truncate text-[13px] leading-5">{item.companyName}</span><span className="mt-2 block"><QualificationPill prospect={item} /></span></span>
            <div className="min-w-0 text-[13px] leading-5"><FitDisplay prospect={item} /></div>
             <span className="min-w-0 text-[12px] leading-[1.55] text-muted-foreground">{valueSummary(item.potentialValueBand, item.qualificationStatus, item.researchStatus)}</span>
             <span className="line-clamp-3 min-w-0 text-[12px] leading-[1.55] text-muted-foreground">{whyNowSummary(item.whyNow)}</span>
             <div className="min-w-0"><StatusPill prospect={item} /></div>
             <div className="min-w-0 [&_button]:max-w-full"><ProspectAction prospect={item} /></div>
          </div>)}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:hidden">
          {visible.map(item => <article key={item.id} className="min-w-0 rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><Link href={`/dashboard/scout/${encodeURIComponent(item.id)}`} className="text-base font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.name}</Link><p className="mt-1 truncate text-sm text-muted-foreground">{item.companyName}</p><div className="mt-2"><QualificationPill prospect={item} /></div></div>
              <div className="shrink-0 text-right"><FitDisplay prospect={item} /></div>
            </div>
            <div className="mt-4"><StatusPill prospect={item} /></div>
            <p className="mt-4 min-h-10 text-sm leading-5 text-muted-foreground">{whyNowSummary(item.whyNow)}</p>
            <p className="mt-2 text-xs text-muted-foreground">Potential value: {valueSummary(item.potentialValueBand, item.qualificationStatus, item.researchStatus)}</p>
            <div className="mt-4 border-t border-border/50 pt-4"><ProspectAction prospect={item} compact /></div>
          </article>)}
        </div>
      </>}
    </>}
  </div>;
}
