import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { getDecisionReplay } from '@/lib/decision/replay';

export const dynamic = 'force-dynamic';
const shown = (value: string | number | null | undefined) => value == null || value === '' ? 'Not recorded' : String(value);
const when = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : 'Not recorded';
const pretty = (value: string | null | undefined) => shown(value?.replaceAll('_', ' '));
const card = 'rounded-lg border border-gray-800 bg-[#121212] p-5';

export default async function DecisionReplayPage({ params }: { params: Promise<{ decisionId: string }> }) {
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) redirect('/login');
  const { decisionId } = await params;
  if (!decisionId || decisionId.length > 100) notFound();
  const replay = await getDecisionReplay({ userId: user.id, decisionId }).catch(error => {
    if (error instanceof Error && /not found for tenant/.test(error.message)) notFound();
    throw error;
  });
  const { trigger, knownAtDecision: known, interpretation, governance, automation, risk, sla, human, execution } = replay;
  const name = `${trigger.prospect.firstName} ${trigger.prospect.lastName}`.trim();
  return <main className="mx-auto max-w-4xl space-y-5 px-4 py-8 text-sm text-gray-300 sm:px-8">
    <header className="space-y-2"><Link href="/dashboard/inbox-triage" className="text-xs text-[#FF5A1F] underline focus-visible:outline">Back to Inbox</Link>
      <h1 className="text-2xl font-semibold text-white">Decision Replay</h1>
      <p>What was recorded for {name || 'this prospect'} · {trigger.prospect.companyName ?? 'Company not recorded'}</p>
      <p className="text-xs text-gray-500">Historical read only · Decision {trigger.decisionId}</p></header>
    <section className={card}><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Trigger</h2>
      <p>Message received: {when(trigger.message.occurredAt)} · Decision created: {when(trigger.decisionAt)}</p>
      <p className="mt-1">Type: {pretty(trigger.decisionType)} · Source: {pretty(trigger.source)}</p>
      <p className="mt-3 whitespace-pre-wrap break-words rounded border border-gray-800 p-3">{shown(trigger.message.body)}</p>
      <p className="mt-2 text-xs text-gray-500">Conversation {trigger.conversationId} · Message {trigger.message.id}</p></section>
    <section className={card}><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">What FrameLeads knew at decision time</h2>
      <p>ICP qualification: {pretty(typeof known.icp?.qualification === 'string' ? known.icp.qualification : null)} · Fit: {shown(known.icp?.fitScore)} · Value band: {pretty(typeof known.icp?.valueBand === 'string' ? known.icp.valueBand : null)}</p>
      <p className="mt-2">Memory references: {known.memory?.eventIds.join(', ') || 'Not recorded'} · Event count: {shown(known.memory?.eventCount)}</p>
      <p className="mt-2">Brain revision: {shown(known.brainRevision)} · Playbook revision: {shown(known.playbookRevision)} · Constitution revision: {shown(known.constitutionRevision)}</p>
      <p className="mt-2">Brain entry IDs: {known.brainEntryIds.join(', ') || 'Not recorded'} · Playbook rule IDs: {known.playbookRuleIds.join(', ') || 'Not recorded'}</p>
      <p className="mt-2">Provider: {pretty(known.provider)} · Model: {shown(known.model)} · Engine: {shown(known.engineVersion)}</p>
      <p className="mt-2 break-all text-xs text-gray-500">Context fingerprint: {shown(known.contextFingerprint)}</p>
      <p className="mt-2 text-xs text-gray-500">Historical Brain and Playbook content was not snapshotted; only recorded revisions and references are shown.</p></section>
    <section className={card}><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Decision interpretation</h2>
      <p>Primary intent: {pretty(interpretation.primaryIntent)} · Confidence: {interpretation.confidenceScore == null ? 'Not recorded' : `${interpretation.confidenceScore}%`}</p>
      <p className="mt-2">Secondary intents: {interpretation.secondaryIntents.join(', ').replaceAll('_', ' ') || 'Not recorded'}</p>
      <p className="mt-2">{shown(interpretation.conciseInterpretation)}</p>
      <p className="mt-2">Recommended action: {pretty(interpretation.recommendedNextAction)} · Review: {interpretation.reviewRequired ? 'Required' : 'Not required'}</p>
      {interpretation.reviewReasons.length > 0 && <p className="mt-2 text-amber-300">Review reasons: {interpretation.reviewReasons.join(', ')}</p>}
      <p className="mt-2">Recorded explanation: {shown(interpretation.explanation)}</p>
      {interpretation.suggestedReply && <details className="mt-3"><summary className="cursor-pointer text-white">Recorded suggested reply</summary><p className="mt-2 whitespace-pre-wrap break-words">{interpretation.suggestedReply}</p></details>}
      {interpretation.intentSignals && <details className="mt-3"><summary className="cursor-pointer text-white">Recorded intent signals</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(interpretation.intentSignals, null, 2)}</pre></details>}</section>
    <section className={card}><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Decision-time governance</h2>
      <p>Constitution revision: {shown(governance.decisionTime?.revision)} · Recorded: {when(governance.decisionTime?.recordedAt)}</p>
      {governance.decisionTime?.policy.length ? governance.decisionTime.policy.map((row, index) => <div key={index} className="mt-3 border-t border-gray-800 pt-3">
        <p>{pretty(row.action)} · {pretty(row.decision)} · Effect: {pretty(row.effectiveEffect)}</p>
        <p className="text-gray-400">{shown(row.winnerReason)}</p>
        <p className="text-xs text-gray-500">Matched rules: {row.matchedRuleIds.join(', ') || 'None recorded'} · Unresolved: {row.unresolvedRuleIds.join(', ') || 'None recorded'}</p>
        {row.ruleTrace.length > 0 && <details className="mt-1"><summary className="cursor-pointer">Recorded precedence</summary>{row.ruleTrace.map((item, key) => <p key={key} className="text-xs text-gray-400">{shown(item.ruleId)}: {shown(item.result)}</p>)}</details>}
      </div>) : <p className="mt-2">Policy result not recorded.</p>}
      <p className="mt-3 border-t border-gray-800 pt-3">Execution-time Constitution revision: {shown(governance.executionTime?.executionConstitutionRevision)} · Decision revision recorded at execution: {shown(governance.executionTime?.decisionConstitutionRevision)}</p>
    </section>
    <section className={card}><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Automation</h2>
      {automation.history.length ? automation.history.map(row => <div key={row.id} className="mb-3 border-b border-gray-800 pb-3">
        <p>{when(row.at)} · {pretty(row.requestedMode)} → {pretty(row.resolvedMode)} · {pretty(row.state)}</p>
        <p className="text-xs text-gray-400">Reasons: {row.reasons.join(', ') || 'None recorded'} · Policy revision: {row.policyRevision}</p>
        <p className="text-xs text-gray-500">Constitution rules: {row.constitutionRuleIds.join(', ') || 'Not recorded'} · Hold reference: {shown(row.prospectHoldId)}</p>
      </div>) : <p>Automation resolution not recorded.</p>}
      {automation.truncated && <p className="text-xs text-amber-300">Older automation records omitted from this bounded view.</p>}
    </section>
    <section className={card}><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Revenue-at-Risk</h2>
      {risk ? <><p>{pretty(risk.status)} · Score: {shown(risk.score)} · Band: {pretty(risk.band)} · Confidence: {pretty(risk.confidence)}</p>
        <p className="mt-2">Assessed: {when(risk.evaluatedAt)} · Scoring version: {shown(risk.scoringVersion)}</p>
        <p className="mt-2">{risk.reasons.join(' ') || 'Reasons not recorded.'}</p>
        <p className="mt-2 text-xs text-amber-300">Latest persisted assessment. Earlier scores may have been replaced; this is not asserted as the original decision-time score.</p></> : <p>Risk assessment not recorded.</p>}
    </section>
    <section className={card}><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Response SLA</h2>
      {sla ? <><p>{pretty(sla.status)} · Started: {when(sla.startedAt)} · Due: {when(sla.dueAt)}</p>
        <p className="mt-2">Initial risk band: {pretty(sla.initialRiskBand)} · Initial risk score: {shown(sla.initialRiskScore)} · Policy revision: {sla.policyRevision}</p>
        <p className="mt-2">Breached: {when(sla.breachedAt)} · Escalation level: {sla.escalationLevel}</p>
        <p className="mt-2">Resolved: {when(sla.resolvedAt)} · Cancelled: {when(sla.cancelledAt)} · Reason: {shown(sla.resolutionReason)}</p></> : <p>Response SLA not recorded.</p>}</section>
    <section className={card}><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Human and execution actions</h2>
      {human.actions.length ? human.actions.map(row => <p key={row.id} className="mb-2">{when(row.at)} · {pretty(row.action)} · {shown(row.reason)}</p>) : <p>Human action not recorded.</p>}
      {human.truncated && <p className="text-xs text-amber-300">Older human actions omitted from this bounded view.</p>}
      {execution ? <div className="mt-3 border-t border-gray-800 pt-3"><p>Execution: {pretty(execution.status)} · Mode: {pretty(execution.mode)} · Started: {when(execution.startedAt)}</p>
        <p className="mt-2">Provider: {shown(execution.provider)} · Message reference: {shown(execution.providerMessageId)} · Failure: {shown(execution.failureClass)}</p>
        {execution.outbound && <p className="mt-2">Linked OutboundLog: {execution.outbound.id} · {pretty(execution.outbound.status)} · {when(execution.outbound.sentAt)}</p>}</div> : <p className="mt-2">Execution attempt not recorded.</p>}
    </section>
    <section className={card}><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Final recorded state</h2>
      <p>{pretty(replay.finalState.state)} · SLA: {pretty(replay.finalState.slaStatus)}</p></section>
    {human.assignment && <section className={card}><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Current recorded assignment</h2>
      <p>{pretty(human.assignment.status)} · {pretty(human.assignment.queue)} · {shown(human.assignment.reason)}</p>
      <p className="mt-2 text-xs text-gray-500">Queue, reason, and status can change. These values are not asserted as the decision-time assignment state.</p></section>}
    <section className={card}><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Chronological timeline</h2>
      <ol className="space-y-3 border-l border-gray-700 pl-4">{replay.timeline.map((item, index) => <li key={`${item.sourceType}-${item.sourceId}-${item.type}-${index}`}>
        <p className="font-medium text-white">{item.title}</p><p className="text-xs text-gray-500">{when(item.at)} · {item.sourceType} {item.sourceId}</p>
        {item.detail && <p className="mt-1 whitespace-pre-wrap break-words text-gray-400">{item.detail}</p>}
      </li>)}</ol></section>
  </main>;
}
