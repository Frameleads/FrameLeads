import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Building2, ExternalLink, Mail, Radar } from 'lucide-react';
import type { ScoutProspectDetail } from '@/lib/scout-data';
import { qualificationLabel, safeEvidenceUrl, scoutHandoffEligible, scoutStatus, whyNowSummary } from '@/lib/scout-view';
import ResearchButton from './ResearchButton';
import QualifyButton from './QualifyButton';
import QualificationOverrideButtons from './QualificationOverrideButtons';
import SendToSandboxButton from './SendToSandboxButton';

function Label({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{children}</h2>;
}

export default function ScoutDetail({ prospect }: { prospect: ScoutProspectDetail }) {
  const intelligence = prospect.intelligence;
  const status = intelligence?.researchStatus ?? 'NOT_RESEARCHED';
  const view = scoutStatus(status);
  const website = safeEvidenceUrl(prospect.websiteUrl);
  const score = intelligence?.fitScore;
  const risks = intelligence?.risks ?? [];

  return <div className="mx-auto max-w-7xl space-y-6">
    <Link href="/dashboard/scout" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Scout</Link>
    <header className="rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary"><Radar className="h-4 w-4" aria-hidden="true" /> Prospect intelligence</div>
          <h1 className="break-words text-2xl font-semibold sm:text-3xl">{prospect.name}</h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Building2 className="h-4 w-4 shrink-0" aria-hidden="true" /> {prospect.companyName}</p>
          {(prospect.jobTitle || prospect.industry || prospect.country || prospect.location || prospect.companySizeMin !== null) && <p className="mt-2 text-xs text-muted-foreground">{[
            prospect.jobTitle, prospect.industry, prospect.country || prospect.location,
            prospect.companySizeMin !== null ? `${prospect.companySizeMin}${prospect.companySizeMax === null ? '+' : prospect.companySizeMax === prospect.companySizeMin ? '' : `–${prospect.companySizeMax}`} employees` : null,
          ].filter(Boolean).join(' · ')}</p>}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {prospect.email && <span className="inline-flex items-center gap-1.5 break-all"><Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{prospect.email}</span>}
            {prospect.websiteUrl && (website ? <a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 break-all text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Open ${prospect.companyName} website in a new tab`}><ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{prospect.websiteUrl}</a> : <span className="break-all">{prospect.websiteUrl}</span>)}
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${view.tone}`}>{view.label}</span>
          {scoutHandoffEligible(prospect.qualification, status) && <SendToSandboxButton prospectId={prospect.id} />}
          {prospect.qualification?.override === 'USER_EXCLUDED' ? null : prospect.qualification?.policyVersion === 0 ? <QualifyButton prospectId={prospect.id} /> : prospect.qualification?.status !== 'QUALIFIED' && status !== 'RESEARCHING' ? <QualifyButton prospectId={prospect.id} /> : status === 'RESEARCHING' ? <ResearchButton prospectId={prospect.id} status={status} /> : status === 'READY' || status === 'NEEDS_REVIEW' ? <ResearchButton prospectId={prospect.id} status={status} forceRefresh /> : <ResearchButton prospectId={prospect.id} status={status} />}
        </div>
      </div>
    </header>

    <div className="rounded-xl border border-border/60 bg-card/30 px-4 py-3 text-sm"><span className="font-medium">Prequalification: {qualificationLabel(prospect.qualification?.status ?? 'UNASSESSED', prospect.qualification?.reasonCode ?? 'NONE', prospect.qualification?.override ?? 'AUTO', prospect.qualification?.policyVersion ?? 1)}</span><span className="ml-2 text-muted-foreground">{prospect.qualification?.policyVersion === 0 ? 'This assessment predates the current qualification policy. Run qualification again.' : prospect.qualification?.qualificationReason ?? 'Run deterministic qualification before new research.'}</span>{prospect.qualification?.status !== 'QUALIFIED' && <Link href="/dashboard/scout/settings" className="ml-2 text-primary hover:underline">ICP Settings</Link>}<QualificationOverrideButtons prospectId={prospect.id} current={prospect.qualification?.override ?? 'AUTO'} /></div>

    {status === 'RESEARCHING' && <div role="status" className="rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-3 text-sm text-sky-200">Researching prospect. This view will update when the assessment is ready.</div>}
    {status === 'FAILED' && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200">Research failed. Retry to run the assessment again. Any earlier assessment is shown below for context.</div>}
    {status === 'NEEDS_REVIEW' && <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">Limited evidence available. Review the available signals before using this assessment.</div>}
    {status === 'NOT_RESEARCHED' && <div className="rounded-xl border border-border/60 bg-card/30 px-4 py-3 text-sm text-muted-foreground">No assessment yet. Research this prospect to review fit and supporting evidence.</div>}

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,.9fr)]">
      <section aria-labelledby="scout-evidence-heading" className="min-w-0 rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6 lg:col-start-2 lg:row-start-1">
        <div className="flex items-center justify-between gap-3"><h2 id="scout-evidence-heading" className="text-sm font-semibold uppercase tracking-[0.14em] text-foreground">Evidence</h2><span className="text-xs text-muted-foreground">{intelligence?.evidence.length ?? 0} records</span></div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Sources and claims that support the current assessment. Internal notes may be unverified.</p>
        {intelligence?.evidence.length ? <ul className="mt-5 space-y-3">
          {intelligence.evidence.map(item => {
            const url = safeEvidenceUrl(item.sourceUrl);
            return <li key={item.id} className="rounded-xl border border-border/50 bg-background/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{item.sourceTitle}</h3><p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{item.evidenceType.replaceAll('_', ' ')}{item.isUserProvided ? ' · User supplied' : ''}</p></div>{item.confidenceScore !== null && <span className="text-xs text-muted-foreground">{item.confidenceScore}% confidence</span>}</div>
              <blockquote className="mt-3 border-l-2 border-primary/50 pl-3 text-sm leading-6 text-foreground/90">{item.claim}</blockquote>
              {url && <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open source ${item.sourceTitle} in a new tab`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open source <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></a>}
            </li>;
          })}
        </ul> : <p className="mt-5 rounded-xl border border-dashed border-border/60 px-4 py-8 text-sm text-muted-foreground">No supporting evidence is stored yet.</p>}
      </section>

      <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-1">
        <section className="rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6">
          <Label>Fit assessment</Label>
          <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-3"><div><span className="text-4xl font-semibold tabular-nums">{score === null || score === undefined ? '—' : score}</span><span className="ml-1 text-sm text-muted-foreground">/ 100</span></div><div className="pb-1 text-sm font-medium text-primary">{intelligence?.fitTier ? `${intelligence.fitTier} FIT` : 'Not scored'}</div></div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Prospect fit score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score ?? undefined} aria-valuetext={score === null || score === undefined ? 'Not scored' : `${score} out of 100`}><div className="h-full rounded-full bg-primary" style={{ width: `${score ?? 0}%` }} /></div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 border-t border-border/50 pt-4 text-sm"><div><span className="block text-xs uppercase tracking-wider text-muted-foreground">Confidence</span><span className="mt-1 block font-medium">{intelligence?.confidenceScore === null || intelligence?.confidenceScore === undefined ? '—' : `${intelligence.confidenceScore}%`}</span></div><div><span className="block text-xs uppercase tracking-wider text-muted-foreground">Potential value</span><span className="mt-1 block font-medium">{intelligence?.potentialValueBand || '—'}{intelligence?.estimatedValueAmount ? ` · ${intelligence.estimatedValueAmount}${intelligence.estimatedValueCurrency ? ` ${intelligence.estimatedValueCurrency}` : ''}` : ''}</span></div></div>
        </section>
        <section className="rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6"><Label>Why they fit</Label><p className="mt-3 text-sm leading-7 text-foreground/90">{intelligence?.whyFit || 'No supported fit explanation yet.'}</p><p className="mt-3 text-xs text-muted-foreground">FrameLeads analysis based on the available evidence.</p></section>
        <section className="rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6"><Label>Why now</Label><p className="mt-3 text-sm leading-7 text-foreground/90">{intelligence?.whyNow || 'No verified timing signal found.'}</p></section>
        <div className="grid gap-5 sm:grid-cols-2">
          <section className="rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6"><Label>Triggers</Label>{intelligence?.triggers.length ? <ul className="mt-3 space-y-2 text-sm leading-6">{intelligence.triggers.map((item, index) => <li key={`${item}-${index}`} className="border-l-2 border-primary/40 pl-3">{item}</li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No supported triggers yet.</p>}</section>
          <section className="rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6"><Label>Risks</Label>{risks.length ? <ul className="mt-3 space-y-3 text-sm leading-6">{risks.map((item, index) => { const analytical = item.startsWith('ANALYSIS:'); const factual = item.startsWith('FACT:'); return <li key={`${item}-${index}`} className="flex items-start gap-2"><span className={`mt-0.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${analytical ? 'border-amber-400/20 text-amber-300' : 'border-border text-muted-foreground'}`}>{analytical ? 'Analysis' : factual ? 'Evidence' : 'Risk'}</span><span>{item.replace(/^(ANALYSIS|FACT):\s*/, '')}</span></li>; })}</ul> : <p className="mt-3 text-sm text-muted-foreground">No risks recorded.</p>}</section>
        </div>
      </div>
    </div>
  </div>;
}
