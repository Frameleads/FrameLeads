'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Info, CalendarCheck, Mail, Trash2, X } from 'lucide-react';
import CalendarPicker from '@/components/CalendarPicker';
import { playUISound } from '@/lib/audio';
import { sortInboxByRevenueRisk } from '@/lib/revenue-risk/sort';
import { hasFeatureAccess } from '@/lib/entitlements';
import { displayResponseSLA, sortInboxByResponseSLA } from '@/lib/response-sla/deadline';
import { deriveIntentSignals } from '@/lib/decision/intent-signals';
import { decisionStatusPresentation } from '@/lib/decision/status-presentation';
import { getDisplayedIntentConfidence } from '@/lib/decision/intent-confidence';

/**
 * Attempt to parse the human-readable slot label returned by the calendar API
 * e.g. "Thursday, Aug 21 at 2:00 PM EDT" → "2026-08-21T14:00:00"
 * Returns null if the label cannot be reliably parsed.
 */
function parseSlotLabel(label: string): string | null {
  const match = label.match(/\w+, (\w+) (\d+) at (\d+):(\d+) (AM|PM)/);
  if (!match) return null;
  const [, monthStr, dayStr, hourStr, minStr, ampm] = match;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = MONTHS.indexOf(monthStr);
  if (month === -1) return null;
  const day = parseInt(dayStr, 10);
  let hour = parseInt(hourStr, 10);
  const min = parseInt(minStr, 10);
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  const year = new Date().getFullYear();
  const date = new Date(year, month, day, hour, min);
  return date.toISOString();
}

interface ImapConnectionForm {
  email: string;
  appPassword: string;
  host: string;
  port: string;
}

const DEFAULT_IMAP_FORM: ImapConnectionForm = {
  email: '',
  appPassword: '',
  host: 'imap.gmail.com',
  port: '993',
};

const ALLOWED_TRIAGE_SIGNALS = new Set([
  'Meeting Requested',
  'Pricing Inquiry',
  'Referred to Colleague',
  'Competitor Mentioned',
  'Timing Objection',
  'Requesting Resources',
  'OOTO / Bounced',
]);

function parseTriageSignals(value: unknown) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((signal) => signal.trim())
    .filter((signal) => ALLOWED_TRIAGE_SIGNALS.has(signal))
    .slice(0, 3);
}

function getPersistedSignals(signals: unknown, legacyIntentRisk: unknown) {
  if (Array.isArray(signals)) {
    return signals
      .filter((signal): signal is string => typeof signal === 'string' && ALLOWED_TRIAGE_SIGNALS.has(signal))
      .slice(0, 3);
  }
  return parseTriageSignals(legacyIntentRisk);
}

type DecisionPacket = { id: string; status: string; primaryIntent: string | null;
  source: string;
  secondaryIntents: string[]; intentSignals?: unknown; confidenceScore: number | null; interpretation: string | null;
  recommendedNextAction: string | null; suggestedReply: string | null; explanation: string | null;
  reviewReasons: string[]; shadowMode: boolean; trace?: { icpState: unknown; policyResult: unknown;
    contextReferences: unknown; memoryState: unknown; intentOutput?: unknown } | null };
type AutomationPacket = { decisionId: string; resolvedMode: string; state: string; reasons: string[];
  ruleIds: string[]; prospectId: string; assignment: { queue: string } | null; hold: { reason: string } | null };
type RevenueRiskView = { status: string; score: number | null; band: string | null;
  confidence: string; reasons: string[]; evaluatedAt?: string };
type ResponseSLAView = { status: 'ACTIVE' | 'BREACHED' | 'RESOLVED' | 'CANCELLED';
  startedAt: string; dueAt: string; breachedAt: string | null; resolvedAt: string | null;
  escalationLevel: number; escalationReason: string | null; assignmentId: string | null;
  riskBandAtStart: string | null; resolutionReason: string | null };

function DecisionPacketPanel({ signalId, reply, onDecision, onRisk, onSLA, dueSoonPercent, isEnterpriseTier }: { signalId: string;
  reply: string;
  onDecision: (signalId: string, status: string, packet?: DecisionPacket) => void;
  onRisk: (signalId: string, risk: RevenueRiskView) => void;
  onSLA: (signalId: string, sla: ResponseSLAView | null) => void; dueSoonPercent: number; isEnterpriseTier: boolean }) {
  const [packet, setPacket] = useState<DecisionPacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [automation, setAutomation] = useState<AutomationPacket | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [editedReply, setEditedReply] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [risk, setRisk] = useState<RevenueRiskView | null>(null);
  const [sla, setSLA] = useState<ResponseSLAView | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setPacket(null);
    setError('');
    fetch(`/api/decisions?signalId=${encodeURIComponent(signalId)}`)
      .then(async response => {
        if (!response.ok) throw new Error('Could not load the decision packet.');
        return response.json();
      })
      .then(data => { if (active) { setPacket(data.decision ?? null);
        if (data.decision) onDecision(signalId, data.decision.status, data.decision); } })
      .catch(() => { if (active) setError('Could not load the decision packet.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [signalId, onDecision]);
  useEffect(() => {
    if (packet?.status !== 'PENDING') return;
    const timer = window.setInterval(() => {
      void fetch(`/api/decisions?signalId=${encodeURIComponent(signalId)}`)
        .then(response => response.ok ? response.json() : null)
        .then(data => { if (data?.decision) { setPacket(data.decision); onDecision(signalId, data.decision.status, data.decision); } })
        .catch(() => { /* The saved packet remains visible; polling can retry. */ });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [packet?.status, signalId, onDecision]);
  useEffect(() => {
    if (!isEnterpriseTier || !packet?.id) { setAutomation(null); return; }
    let active = true;
    fetch(`/api/automation/decision?signalId=${encodeURIComponent(signalId)}`)
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (active) setAutomation(data?.automation ?? null); })
      .catch(() => { if (active) setActionError('Automation state could not load.'); });
    return () => { active = false; };
  }, [packet?.id, signalId, isEnterpriseTier]);
  useEffect(() => {
    if (!isEnterpriseTier || !packet?.id) { setRisk(null); return; }
    let active = true;
    fetch(`/api/revenue-risk?decisionId=${encodeURIComponent(packet.id)}`)
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (active && data?.risk) { setRisk(data.risk); onRisk(signalId, data.risk); } })
      .catch(() => { /* Persisted Inbox assessment remains available after a transient refresh failure. */ });
    return () => { active = false; };
  }, [packet?.id, signalId, onRisk, isEnterpriseTier]);
  useEffect(() => {
    if (!isEnterpriseTier || !packet?.id) { setSLA(null); return; }
    let active = true;
    fetch(`/api/response-sla?decisionId=${encodeURIComponent(packet.id)}`)
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (active && data) { setSLA(data.sla ?? null); onSLA(signalId, data.sla ?? null); } })
      .catch(() => { /* The persisted Inbox SLA remains visible after a transient refresh failure. */ });
    return () => { active = false; };
  }, [packet?.id, signalId, onSLA, isEnterpriseTier]);
  async function refreshSLA() {
    if (!isEnterpriseTier || !packet?.id) return;
    const response = await fetch(`/api/response-sla?decisionId=${encodeURIComponent(packet.id)}`);
    if (response.ok) { const next = (await response.json()).sla ?? null; setSLA(next); onSLA(signalId, next); }
  }
  async function refreshAutomation() {
    const response = await fetch(`/api/automation/decision?signalId=${encodeURIComponent(signalId)}`);
    if (response.ok) setAutomation((await response.json()).automation ?? null);
  }
  async function governedAction(action: 'APPROVE' | 'EDIT_AND_SEND' | 'REJECT' | 'ESCALATE') {
    if (!packet || actionBusy) return;
    setActionBusy(true); setActionError('');
    try {
      const response = await fetch('/api/automation/actions', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          decisionId: packet.id, action, requestKey: crypto.randomUUID(),
          editedReply: action === 'EDIT_AND_SEND' ? editedReply : undefined, reason: actionReason || undefined }) });
      if (!response.ok) throw new Error('Action could not be completed. Review the current policy and try again.');
      const result = await response.json();
      if (result.state === 'FAILED_UNCERTAIN') setActionError('Send outcome is uncertain. Check the provider before taking another action.');
      await refreshAutomation();
      await refreshSLA();
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Action could not be completed.'); }
    finally { setActionBusy(false); }
  }
  async function toggleHold() {
    if (!automation || actionBusy) return;
    setActionBusy(true); setActionError('');
    try {
      const response = await fetch('/api/automation/holds', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          prospectId: automation.prospectId, active: !automation.hold,
          reason: automation.hold ? undefined : (actionReason.trim() || 'Human hold pending review') }) });
      if (!response.ok) throw new Error('Prospect hold could not be updated.');
      await refreshAutomation();
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Hold could not be updated.'); }
    finally { setActionBusy(false); }
  }
  async function run(retry: boolean) {
    if (running) return;
    setRunning(true);
    setError('');
    try {
      const response = await fetch('/api/decisions/triage', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signalId, retryOfDecisionId: retry ? packet?.id : undefined }) });
      if (!response.ok) throw new Error('Decision analysis failed. The reply is safely stored; retry when ready.');
      const result = await response.json();
      if (result.decision) { setPacket(result.decision); onDecision(signalId, result.decision.status, result.decision); }
      else setError('Prospect identity is unresolved. Review this reply manually.');
    } catch { setError('Decision analysis failed. The reply is safely stored; retry when ready.'); }
    finally { setRunning(false); }
  }
  const statusPresentation = decisionStatusPresentation(packet?.status);
  const label = packet?.status === 'PENDING' ? 'Analyzing' : packet ? statusPresentation.label : 'Not analyzed';
  const icp = packet?.trace?.icpState as { qualification?: string; fitTier?: string; valueBand?: string } | undefined;
  const policy = Array.isArray(packet?.trace?.policyResult) ? packet.trace.policyResult as { decision?: string; matchedRuleIds?: string[] }[] : [];
  const intentLabel = packet?.primaryIntent?.replaceAll('_', ' ') ?? 'Intent unresolved';
  const actionLabel = packet?.recommendedNextAction?.replaceAll('_', ' ') ?? 'Review manually';
  const matchedRuleIds = [...new Set(policy.flatMap(item => item.matchedRuleIds ?? []))];
  const isReview = packet?.status === 'NEEDS_REVIEW';
  return <section aria-label="Decision packet" className="relative isolate min-h-[18rem] w-full max-w-full min-w-0 overflow-hidden rounded-2xl border border-white/[0.1] bg-[#151515] p-5 sm:p-7">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_78%_0%,rgba(255,90,31,.075),transparent_35%)]" />
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="font-heading text-base font-semibold uppercase tracking-wide text-white">Decision Packet</h2>
        <span className={`rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider ${packet ? statusPresentation.badgeTone : 'border-white/[0.12] bg-white/[0.03] text-white/65'}`}>{label}</span>
        <span className="rounded-full border border-white/[0.09] bg-black/15 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-white/45">{packet?.source === 'GEMINI' ? 'AI-assisted' : packet?.source === 'DETERMINISTIC' ? 'Deterministic' : 'Unresolved'}</span>
        {automation && <span className="rounded-full border border-white/[0.09] bg-black/15 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-white/45">Governed execution</span>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {packet && <Link href={`/dashboard/decisions/${encodeURIComponent(packet.id)}/replay`} className="inline-flex min-h-11 items-center rounded-lg border border-white/[0.1] px-3 py-2 text-xs text-white/65 transition-colors hover:border-white/25 hover:text-white focus-visible:outline">Replay</Link>}
        <button type="button" disabled={running || loading || packet?.status === 'PENDING'} onClick={() => void run(Boolean(packet))}
          className="min-h-11 rounded-lg border border-[#FF5A1F]/35 bg-[#FF5A1F]/[0.06] px-3 py-2 text-xs font-semibold text-[#FF5A1F] transition-colors hover:bg-[#FF5A1F]/[0.12] disabled:opacity-40">
          {running ? 'Analyzing…' : packet ? 'Re-analyze' : 'Analyze reply'}
        </button>
      </div>
    </header>
    {loading && <p role="status" className="mt-4 text-sm text-gray-400">Loading decision…</p>}
    {running && <p role="status" className="mt-4 text-sm text-gray-400">Analyzing reply…</p>}
    {error && <p role="alert" className="mt-4 text-sm text-amber-400">{error}</p>}
    {packet && <div className="pt-5">
        <div className="grid gap-5">
          <div className="min-w-0">
          <p className="font-mono text-[9px] uppercase tracking-[.18em] text-[#FF5A1F]">Incoming reply</p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">“{reply}”</p>
          <h3 className="mt-4 max-w-full break-words font-heading text-xl font-semibold leading-8 text-white sm:text-2xl xl:whitespace-nowrap">{packet.interpretation ?? 'Decision interpretation pending'}</h3>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard label="Intent" value={intentLabel} detail={packet.secondaryIntents.length ? `Secondary · ${packet.secondaryIntents.join(', ').replaceAll('_', ' ')}` : 'No secondary intent'} active />
        <SummaryCard label="Governance" value={policy.map(item => item.decision ?? 'Review').join(' · ') || 'Review required'} detail={matchedRuleIds.length ? `${matchedRuleIds.length} matched ${matchedRuleIds.length === 1 ? 'rule' : 'rules'}` : 'No matching rule recorded'} active={matchedRuleIds.length > 0} />
        <SummaryCard label="Recommended action" value={actionLabel} detail={packet.reviewReasons.join(' · ').replaceAll('_', ' ') || (isReview ? 'Human review required' : 'Routine handling')} active={isReview} />
      </div>

      {isReview && <div className="mt-4 flex flex-col gap-3 rounded-xl border border-[#FF5A1F]/15 bg-[#1A1A1A]/75 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#FF5A1F]" />
          <div className="min-w-0"><p className="font-mono text-[8px] uppercase tracking-[.16em] text-[#FF5A1F]">Why human review</p>
            <p className="mt-1 break-words text-xs leading-5 text-white/75 sm:text-sm">{packet.explanation ?? packet.reviewReasons.join(', ').replaceAll('_', ' ')}</p></div>
        </div>
        <span className="ml-5 w-fit shrink-0 rounded-full border border-[#FF5A1F]/25 bg-[#FF5A1F]/[0.05] px-2.5 py-1 font-mono text-[8px] uppercase tracking-wider text-[#FF5A1F]">{packet.reviewReasons.includes('APPROVAL_REQUIRED') ? 'Approval required' : 'Review required'}</span>
      </div>}

      {(risk || sla) && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[8px] uppercase tracking-wider text-white/35">
        {risk && <span>Revenue priority · {risk.status === 'APPLICABLE' ? `${risk.score} ${risk.band}` : risk.status.replaceAll('_', ' ')}</span>}
        {sla && <span>Response SLA · {sla.status}</span>}
      </div>}
    </div>}
  </section>;
}

function SummaryCard({ label, value, detail, active = false }: { label: string; value: string; detail: string; active?: boolean }) {
  return <article className={`min-w-0 rounded-xl border p-4 ${active ? 'border-[#FF5A1F]/25 bg-[#FF5A1F]/[0.035]' : 'border-white/[0.08] bg-black/10'}`}>
    <p className="font-mono text-[8px] uppercase tracking-[.16em] text-white/40">{label}</p>
    <p className={`mt-2 truncate text-sm font-semibold uppercase ${active ? 'text-[#FF5A1F]' : 'text-white/85'}`} title={value}>{value}</p>
    <p className="mt-1 line-clamp-2 break-words text-[10px] leading-4 text-white/45">{detail}</p>
  </article>;
}

export default function TriageCommandCenter({
  initialData,
  userTier,
  slaDueSoonPercent = 75,
}: {
  initialData: any;
  userTier: string;
  slaDueSoonPercent?: number;
}) {
  const router = useRouter();
  const isCoreTier = !hasFeatureAccess(userTier, 'AUTOMATION');
  const hasInboxAccess = hasFeatureAccess(userTier, 'INBOX_TRIAGE');
  const isEnterpriseTier = hasFeatureAccess(userTier, 'REVENUE_RISK');
  const hasDecisionEngineAccess = hasFeatureAccess(userTier, 'DECISION_ENGINE');
  const dbLeads = useMemo(() => Array.isArray(initialData) && initialData.length > 0
    ? initialData.map((s: any) => ({
        id: s.id,
        name: s.prospectName || 'Unknown Prospect',
        company: s.prospectContext || 'Unknown Company',
        email: s.prospectEmail || '',
        pipelineValue: `$${(s.pipelineValue || 0).toLocaleString()}`,
        dealStage: s.dealStage || '',
        createdAt: s.createdAt,
        inboundSignal: s.rawEmail || '',
        intentScore: s.intentScore || 0,
        status: s.intentType || 'COLD',
        recordStatus: s.status || 'PENDING',
        draftText: s.aiDraft || 'Awaiting Triage Draft...',
        signals: getPersistedSignals(s.signals, s.intentRisk),
        intentRisk: s.intentRisk,
        whyNowSignals: deriveIntentSignals({ triageSignals: getPersistedSignals(s.signals, s.intentRisk),
          intentRisk: s.intentRisk, reply: s.rawEmail || '' }),
        strategyLogic: s.signalAnalysis || "Awaiting strategy logic...",
        decisionStatus: s.decisionStatus || null,
        decisionSource: s.decisionSource || null,
        revenueRisk: s.revenueRisk || null,
        responseSLA: s.responseSLA || null,
      }))
    : [], [initialData]);

  const [leads, setLeads] = useState<any[]>(dbLeads);
  const updateDecisionStatus = useCallback((signalId: string, status: string, packet?: DecisionPacket) => {
    setLeads(current => current.map(lead => {
      if (lead.id !== signalId) return lead;
      const whyNowSignals = packet ? deriveIntentSignals({ decision: packet,
        triageSignals: lead.signals, intentRisk: lead.intentRisk, reply: lead.inboundSignal }) : lead.whyNowSignals;
      return { ...lead, decisionStatus: status,
        ...(packet ? { decisionPacket: packet, whyNowSignals } : {}) };
    }));
  }, []);
  const updateRevenueRisk = useCallback((signalId: string, risk: RevenueRiskView) => {
    setLeads(current => current.map(lead => lead.id === signalId ? { ...lead, revenueRisk: risk } : lead));
  }, []);
  const updateResponseSLA = useCallback((signalId: string, sla: ResponseSLAView | null) => {
    setLeads(current => current.map(lead => lead.id === signalId ? { ...lead, responseSLA: sla } : lead));
  }, []);
  const [queueView, setQueueView] = useState<'active' | 'archived'>('active');
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [orderBy, setOrderBy] = useState<'received' | 'risk' | 'sla'>('received');
  const [urgentSLAOnly, setUrgentSLAOnly] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer); }, []);
  const filteredLeads = leads.filter((lead) =>
    (queueView === 'archived' ? lead.recordStatus === 'ARCHIVED' : lead.recordStatus === 'PENDING') &&
    (!needsReviewOnly || lead.decisionStatus === 'NEEDS_REVIEW') &&
    (!isEnterpriseTier || !urgentSLAOnly || (lead.responseSLA && ['DUE_SOON', 'OVERDUE'].includes(displayResponseSLA({
      status: lead.responseSLA.status, startedAt: new Date(lead.responseSLA.startedAt),
      dueAt: new Date(lead.responseSLA.dueAt), dueSoonPercent: slaDueSoonPercent }, new Date(clock)).state))),
  );
  const visibleLeads = isEnterpriseTier && orderBy === 'risk' ? sortInboxByRevenueRisk(filteredLeads) :
    isEnterpriseTier && orderBy === 'sla' ? sortInboxByResponseSLA(filteredLeads, new Date(clock), slaDueSoonPercent) : filteredLeads;
  const [activeLeadId, setActiveLeadId] = useState(
    dbLeads.find((lead: any) => lead.recordStatus === 'PENDING')?.id || null,
  );
  const activeLead = visibleLeads.find(l => l.id === activeLeadId) || visibleLeads[0] || null;

  const [isEditing, setIsEditing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchSuccess, setDispatchSuccess] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [regenerateError, setRegenerateError] = useState('');
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [bookingSlotStart, setBookingSlotStart] = useState('');
  const [bookingSlotEnd, setBookingSlotEnd] = useState('');
  const [inboundSignal, setInboundSignal] = useState(activeLead ? activeLead.inboundSignal : '');
  const [draftText, setDraftText] = useState<any>(activeLead ? activeLead.draftText : '');
  const [intentScore, setIntentScore] = useState(activeLead ? activeLead.intentScore : 0);
  const displayedIntentScore = getDisplayedIntentConfidence({ intentScore }) ?? 0;
  const [temperature, setTemperature] = useState(activeLead ? (activeLead.status === 'HOT' ? '🔥 HOT' : activeLead.status === 'WARM' ? '☀️ WARM' : '❄️ COLD') : '');
  const [signals, setSignals] = useState<string[]>(activeLead ? activeLead.signals : []);
  const [inboxConnectionMessage, setInboxConnectionMessage] = useState('');
  const [showInboundSignalToast, setShowInboundSignalToast] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isConnectInboxOpen, setIsConnectInboxOpen] = useState(false);
  const [isConnectingInbox, setIsConnectingInbox] = useState(false);
  const [imapConnectionError, setImapConnectionError] = useState('');
  const [imapForm, setImapForm] = useState<ImapConnectionForm>(DEFAULT_IMAP_FORM);
  const [isArchiving, setIsArchiving] = useState(false);
  const [deletingArchivedId, setDeletingArchivedId] = useState<string | null>(null);
  const [archiveToast, setArchiveToast] = useState('');
  const selectedStateLeadId = useRef(activeLead?.id ?? null);

  useEffect(() => {
    setMounted(true);

    if (!hasInboxAccess) return;

    const loadMailboxSettings = async () => {
      const response = await fetch('/api/inbox/credentials', { cache: 'no-store' }).catch(() => null);
      if (!response?.ok) return;
      const result = await response.json().catch(() => null);
      if (!result?.mailbox) return;

      setImapForm((current) => ({
        ...current,
        email: result.mailbox.email || '',
        host: result.mailbox.host || current.host,
        port: String(result.mailbox.port || 993),
      }));
    };

    void loadMailboxSettings();
  }, [hasInboxAccess]);

  useEffect(() => {
    if (!hasInboxAccess) return;

    let disposed = false;
    let requestInFlight = false;
    let activeController: AbortController | null = null;
    let toastTimeout: ReturnType<typeof setTimeout> | null = null;

    const pollNativeInbox = async () => {
      if (requestInFlight || disposed) return;
      requestInFlight = true;
      activeController = new AbortController();

      try {
        const response = await fetch('/api/inbox/sync', {
          method: 'POST',
          cache: 'no-store',
          signal: activeController.signal,
        });
        if (!response.ok || disposed) return;

        const result = await response.json().catch(() => null);
        if ((Number(result?.newSignalsAdded) || 0) <= 0 || disposed) return;

        playUISound('notification');
        setShowInboundSignalToast(true);
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => setShowInboundSignalToast(false), 4000);
        router.refresh();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          // Polling is intentionally silent; the next interval retries automatically.
        }
      } finally {
        requestInFlight = false;
        activeController = null;
      }
    };

    const interval = window.setInterval(() => void pollNativeInbox(), 15_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      if (toastTimeout) clearTimeout(toastTimeout);
      activeController?.abort();
    };
  }, [hasInboxAccess, router]);

  useEffect(() => {
    setLeads(dbLeads);
    setActiveLeadId((currentId: string | null) =>
      currentId && dbLeads.some((lead: any) =>
        lead.id === currentId && (queueView === 'archived' ? lead.recordStatus === 'ARCHIVED' : lead.recordStatus === 'PENDING'),
      )
        ? currentId
        : dbLeads.find((lead: any) =>
            queueView === 'archived' ? lead.recordStatus === 'ARCHIVED' : lead.recordStatus === 'PENDING',
          )?.id || null,
    );
  }, [dbLeads, queueView]);

  useEffect(() => {
    if (activeLead && selectedStateLeadId.current !== activeLead.id) {
      selectedStateLeadId.current = activeLead.id;
      setInboundSignal(activeLead.inboundSignal);
      setDraftText(activeLead.draftText);
      setIntentScore(activeLead.intentScore);
      setTemperature(activeLead.status === 'HOT' ? '🔥 HOT' : activeLead.status === 'WARM' ? '☀️ WARM' : '❄️ COLD');
      setSignals(activeLead.signals);
    }
  }, [activeLeadId, activeLead]);

  // Concierge slots returned by the triage AI (populated after Regenerate)
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);

  const selectLead = useCallback((lead: any) => {
    if (!lead) return;
    selectedStateLeadId.current = lead.id;
    setInboundSignal(lead.inboundSignal);
    setDraftText(lead.draftText);
    setIntentScore(lead.intentScore);
    setTemperature(lead.status === 'HOT' ? 'ðŸ”¥ HOT' : lead.status === 'WARM' ? 'â˜€ï¸ WARM' : 'â„ï¸ COLD');
    setSignals(lead.signals);
    setIsEditing(false);
    setRegenerateError('');
    setBookingError('');
    setShowBookingModal(false);
    setAvailableSlots([]);
    setActiveLeadId(lead.id);
  }, []);

  const selectLeadById = useCallback((id: string | null, rows: any[] = leads) => {
    const lead = rows.find(item => item.id === id);
    if (lead) selectLead(lead);
    else setActiveLeadId(null);
  }, [leads, selectLead]);

  const getProgressBarColor = (score: number) => {
    if (score >= 71) return 'bg-green-500';
    if (score >= 31) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const handleRegenerate = async () => {
    setIsGenerating(true);
    setRegenerateError('');
    try {
      const res = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inboundSignal: inboundSignal,
          signalId: activeLead?.id,
          timestamp: Date.now(),
          force_regenerate: true
        }),
        cache: 'no-store'
      });
      
      if (res.ok) {
        const data = await res.json();
        if (typeof data.intentScore === 'number') {
          setIntentScore(data.intentScore);
          setTemperature(data.category === 'HOT' ? '🔥 HOT' : data.category === 'WARM' ? '☀️ WARM' : '❄️ COLD');
          setSignals(Array.isArray(data.signals) ? data.signals : []);
          setDraftText(typeof data.draftResponse === 'string' ? data.draftResponse : 'Awaiting Triage Draft...');
          setLeads((current) => current.map((lead) => lead.id === activeLead?.id
            ? {
                ...lead,
                intentScore: data.intentScore,
                status: data.category,
                signals: Array.isArray(data.signals) ? data.signals : [],
                whyNowSignals: deriveIntentSignals({ decision: lead.decisionPacket,
                  triageSignals: Array.isArray(data.signals) ? data.signals : [],
                  intentRisk: data.intentRisk, reply: lead.inboundSignal }),
                strategyLogic: typeof data.strategy === 'string' ? data.strategy : '',
                draftText: typeof data.draftResponse === 'string' ? data.draftResponse : lead.draftText,
              }
            : lead));
          return;
        }
      }
      
      const errorPayload = await res.json().catch(() => null);
      setRegenerateError(errorPayload?.error || 'Draft generation failed. Your existing draft was preserved.');
    } catch (err) {
      console.error(err);
      setRegenerateError('Draft generation is temporarily unavailable. Your existing draft was preserved.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDispatch = async () => {
    if (!activeLead) return;
    setIsDispatching(true);
    try {
      const finalBody = typeof draftText === 'object' && draftText !== null
        ? (draftText as any).body || ''
        : String(draftText);

      const payload = {
        leadId: activeLead.id,
        replyText: finalBody,
        leadEmail: activeLead.email
      };

      const res = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setDispatchSuccess(true);
        setTimeout(() => setDispatchSuccess(false), 4000);
        
        // Remove from local queue
        const newLeads = leads.filter(l => l.id !== activeLead.id);
        setLeads(newLeads);
        selectLeadById(newLeads.find((lead) => lead.recordStatus === 'PENDING')?.id || null, newLeads);
      } else {
        const errData = await res.json().catch(() => null);
        console.warn("Backend dispatch response non-200:", errData || res.statusText);
      }
    } catch (err) {
      console.error("Network transmission error during dispatch:", err);
    } finally {
      setIsDispatching(false);
    }
  };

  // ── Prospect entity context ──
  const PROSPECT_NAME = activeLead?.name || '';
  const PROSPECT_EMAIL = activeLead?.email || '';
  const PROSPECT_COMPANY = activeLead?.company || '';
  const isHotLead = hasDecisionEngineAccess && intentScore >= 71;
  const displayedSignals: string[] = activeLead?.whyNowSignals?.length ? activeLead.whyNowSignals : signals;

  const handleLockMeeting = async () => {
    if (!bookingSlotStart || !bookingSlotEnd) return;
    setIsBooking(true);
    setBookingError('');
    try {
      const res = await fetch('/api/calendar/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: activeLead?.id,
          prospectName: PROSPECT_NAME,
          prospectEmail: PROSPECT_EMAIL,
          startTimeIso: bookingSlotStart,
          endTimeIso: bookingSlotEnd,
        }),
      });
      const data = await res.json();
      if (data.success) {
        playUISound('lock');
        setShowBookingModal(false);
        setBookingSuccess(true);
        setTimeout(() => setBookingSuccess(false), 5000);
        
        // Remove from local queue
        const newLeads = leads.filter(l => l.id !== activeLead?.id);
        setLeads(newLeads);
        selectLeadById(newLeads.find((lead) => lead.recordStatus === 'PENDING')?.id || null, newLeads);
      } else {
        setBookingError(data.error || 'Booking failed. Check your Google credentials.');
      }
    } catch (err) {
      setBookingError('Network error. Could not reach the booking API.');
    } finally {
      setIsBooking(false);
    }
  };

  const showArchiveToast = (message: string) => {
    setArchiveToast(message);
    window.setTimeout(() => setArchiveToast(''), 3500);
  };

  const handleQueueViewChange = (view: 'active' | 'archived') => {
    setQueueView(view);
    selectLeadById(
      leads.find((lead) => view === 'archived'
        ? lead.recordStatus === 'ARCHIVED'
        : lead.recordStatus === 'PENDING')?.id || null, leads,
    );
  };

  const handleArchive = async () => {
    if (!activeLead || activeLead.recordStatus !== 'PENDING') return;
    setIsArchiving(true);

    try {
      const response = await fetch('/api/triage/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeLead.id }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'Unable to archive this lead.');

      const updatedLeads = leads.map((lead) =>
        lead.id === activeLead.id ? { ...lead, recordStatus: 'ARCHIVED' } : lead,
      );
      setLeads(updatedLeads);
      selectLeadById(updatedLeads.find((lead) => lead.recordStatus === 'PENDING')?.id || null, updatedLeads);
      showArchiveToast('Lead archived');
      router.refresh();
    } catch (error) {
      showArchiveToast(error instanceof Error ? error.message : 'Unable to archive this lead.');
    } finally {
      setIsArchiving(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!activeLead || activeLead.recordStatus !== 'ARCHIVED') return;
    if (!window.confirm('Permanently delete this archived lead? This action cannot be undone.')) return;

    setDeletingArchivedId(activeLead.id);
    try {
      const response = await fetch('/api/triage/archive', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeLead.id }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'Unable to permanently delete this lead.');

      const remainingLeads = leads.filter((lead) => lead.id !== activeLead.id);
      setLeads(remainingLeads);
      selectLeadById(remainingLeads.find((lead) => lead.recordStatus === 'ARCHIVED')?.id || null, remainingLeads);
      showArchiveToast('Lead permanently deleted');
      router.refresh();
    } catch (error) {
      showArchiveToast(error instanceof Error ? error.message : 'Unable to permanently delete this lead.');
    } finally {
      setDeletingArchivedId(null);
    }
  };

  const handleConnectInbox = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsConnectingInbox(true);
    setImapConnectionError('');

    try {
      const response = await fetch('/api/inbox/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: imapForm.email,
          appPassword: imapForm.appPassword,
          host: imapForm.host,
          port: Number(imapForm.port),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || 'Unable to connect the inbox.');
      }

      setImapForm((current) => ({ ...current, appPassword: '' }));
      setIsConnectInboxOpen(false);
      setInboxConnectionMessage('Inbox connected successfully.');
    } catch (error) {
      setImapConnectionError(error instanceof Error ? error.message : 'Unable to connect the inbox.');
    } finally {
      setIsConnectingInbox(false);
    }
  };

  const connectInboxButton = (
    <button
      type="button"
      onClick={() => {
        setImapConnectionError('');
        setIsConnectInboxOpen(true);
      }}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#FF5A1F] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#FF5A1F]/90"
    >
      <Mail className="h-4 w-4" />
      Connect Native Inbox
    </button>
  );

  const inboxActions = (
    <div className="flex flex-wrap items-center justify-center gap-3 md:justify-end">
      {connectInboxButton}
    </div>
  );

  const connectInboxModal = isConnectInboxOpen && mounted
    ? createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleConnectInbox}
            className="w-full max-w-xl overflow-hidden rounded-xl border border-[#242424] bg-[#1A1A1A] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-inbox-title"
          >
            <div className="flex items-start justify-between border-b border-[#242424] p-6">
              <div>
                <h2 id="connect-inbox-title" className="text-xl font-semibold text-white">
                  Connect Native Inbox
                </h2>
                <p className="mt-1 text-sm text-[#888888]">
                  Use an app password for Gmail, Outlook, or Yahoo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsConnectInboxOpen(false)}
                disabled={isConnectingInbox}
                aria-label="Close inbox connection modal"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#888888] transition-colors hover:bg-[#242424] hover:text-white disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
              <div>
                <label htmlFor="imap-email" className="mb-1.5 block text-sm font-medium text-[#888888]">
                  Email Address
                </label>
                <input
                  id="imap-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={imapForm.email}
                  onChange={(event) => setImapForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="you@company.com"
                  className="w-full rounded-lg border border-[#242424] bg-black px-4 py-3 text-white outline-none transition-colors placeholder:text-[#888888] focus:border-[#FF5A1F] focus:ring-1 focus:ring-[#FF5A1F]"
                />
              </div>

              <div>
                <label htmlFor="imap-password" className="mb-1.5 block text-sm font-medium text-[#888888]">
                  App Password
                </label>
                <input
                  id="imap-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={imapForm.appPassword}
                  onChange={(event) => setImapForm((current) => ({ ...current, appPassword: event.target.value }))}
                  placeholder="Provider app password"
                  className="w-full rounded-lg border border-[#242424] bg-black px-4 py-3 text-white outline-none transition-colors placeholder:text-[#888888] focus:border-[#FF5A1F] focus:ring-1 focus:ring-[#FF5A1F]"
                />
              </div>

              <div>
                <label htmlFor="imap-host" className="mb-1.5 block text-sm font-medium text-[#888888]">
                  IMAP Host
                </label>
                <input
                  id="imap-host"
                  type="text"
                  required
                  list="supported-imap-hosts"
                  value={imapForm.host}
                  onChange={(event) => setImapForm((current) => ({ ...current, host: event.target.value }))}
                  placeholder="imap.gmail.com"
                  className="w-full rounded-lg border border-[#242424] bg-black px-4 py-3 text-white outline-none transition-colors placeholder:text-[#888888] focus:border-[#FF5A1F] focus:ring-1 focus:ring-[#FF5A1F]"
                />
                <datalist id="supported-imap-hosts">
                  <option value="imap.gmail.com" />
                  <option value="outlook.office365.com" />
                  <option value="imap.mail.yahoo.com" />
                </datalist>
              </div>

              <div>
                <label htmlFor="imap-port" className="mb-1.5 block text-sm font-medium text-[#888888]">
                  Port
                </label>
                <input
                  id="imap-port"
                  type="number"
                  required
                  min={1}
                  max={65535}
                  value={imapForm.port}
                  onChange={(event) => setImapForm((current) => ({ ...current, port: event.target.value }))}
                  className="w-full rounded-lg border border-[#242424] bg-black px-4 py-3 text-white outline-none transition-colors placeholder:text-[#888888] focus:border-[#FF5A1F] focus:ring-1 focus:ring-[#FF5A1F]"
                />
              </div>
            </div>

            <div className="border-t border-[#242424] p-6">
              {imapConnectionError && (
                <p className="mb-4 rounded-lg border border-[#FF5A1F]/30 bg-black p-3 text-sm text-[#FF5A1F]">
                  {imapConnectionError}
                </p>
              )}
              <p className="mb-4 text-xs leading-relaxed text-[#888888]">
                Your app password is encrypted before storage and is never returned to the browser.
              </p>
              <button
                type="submit"
                disabled={isConnectingInbox}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#FF5A1F] px-4 py-3 font-medium text-white transition-colors hover:bg-[#FF5A1F]/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isConnectingInbox && <Loader2 className="h-4 w-4 animate-spin" />}
                {isConnectingInbox ? 'Connecting...' : 'Connect Inbox'}
              </button>
            </div>
          </form>
        </div>,
        document.body,
      )
    : null;

  const inboundSignalToast = showInboundSignalToast && mounted
    ? createPortal(
        <div
          role="status"
          className="fixed inset-x-4 top-6 sm:left-auto sm:right-6 z-[10000] rounded-xl border border-[#FF5A1F]/30 bg-[#121212] px-5 py-4 text-sm font-semibold text-white shadow-2xl shadow-[#FF5A1F]/10 animate-in fade-in slide-in-from-top-2 duration-300"
        >
          🔥 New inbound signal detected!
        </div>,
        document.body,
      )
    : null;

  const activeCount = leads.filter((lead) => lead.recordStatus === 'PENDING').length;
  const archivedCount = leads.filter((lead) => lead.recordStatus === 'ARCHIVED').length;
  const queueTabs = (
    <div className="grid w-full min-w-0 grid-cols-1 gap-2 rounded-2xl border border-white/[0.08] bg-[#111111] p-2 sm:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr_1.1fr] xl:gap-1.5 xl:p-2.5">
      <div role="group" aria-label="Sort by" className="min-w-0 rounded-xl border border-white/[0.06] bg-[#1A1A1A]/70 p-2">
        <p className="mb-1 px-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[#888888]">Sort by</p>
        <div className="flex flex-nowrap items-center gap-0.5">
          {(isEnterpriseTier ? [{ value: 'received', label: 'Received' }, { value: 'risk', label: 'Revenue priority' }, { value: 'sla', label: 'SLA due' }] : [{ value: 'received', label: 'Received' }]).map(option => <button key={option.value} type="button" aria-pressed={orderBy === option.value} onClick={() => setOrderBy(option.value as typeof orderBy)}
            className={`min-h-9 whitespace-nowrap rounded-lg px-2 py-2 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F] ${orderBy === option.value ? 'bg-[#FF5A1F]/[0.09] text-[#FF5A1F]' : 'text-[#888888] hover:bg-[#242424] hover:text-white'}`}>
            {option.label}
          </button>)}
        </div>
      </div>
      {isEnterpriseTier && <div role="group" aria-label="SLA urgency" className="min-w-0 rounded-xl border border-white/[0.06] bg-[#1A1A1A]/70 p-2">
        <p className="mb-1 px-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[#888888]">SLA urgency</p>
        <div className="flex flex-nowrap items-center gap-1">
          <button type="button" aria-pressed={!urgentSLAOnly} onClick={() => setUrgentSLAOnly(false)} className={`min-h-9 rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F] ${!urgentSLAOnly ? 'bg-[#FF5A1F]/[0.09] text-[#FF5A1F]' : 'text-[#888888] hover:bg-[#242424] hover:text-white'}`}>All</button>
          <button type="button" aria-pressed={urgentSLAOnly} onClick={() => setUrgentSLAOnly(true)} className={`min-h-9 whitespace-nowrap rounded-lg px-2.5 py-2 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${urgentSLAOnly ? 'bg-amber-500/10 text-amber-300' : 'text-[#888888] hover:bg-[#242424] hover:text-white'}`}>Due soon / overdue</button>
        </div>
      </div>}
      <div role="group" aria-label="Review" className="min-w-0 rounded-xl border border-white/[0.06] bg-[#1A1A1A]/70 p-2">
        <p className="mb-1 px-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[#888888]">Review</p>
        <div className="flex flex-nowrap items-center gap-1">
          <button type="button" aria-pressed={!needsReviewOnly} onClick={() => setNeedsReviewOnly(false)} className={`min-h-9 rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F] ${!needsReviewOnly ? 'bg-[#FF5A1F]/[0.09] text-[#FF5A1F]' : 'text-[#888888] hover:bg-[#242424] hover:text-white'}`}>All</button>
          <button type="button" aria-pressed={needsReviewOnly} onClick={() => setNeedsReviewOnly(true)} className={`min-h-9 whitespace-nowrap rounded-lg px-2.5 py-2 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${needsReviewOnly ? 'bg-amber-500/10 text-amber-300' : 'text-[#888888] hover:bg-[#242424] hover:text-white'}`}>Needs review</button>
        </div>
      </div>
      <div role="group" aria-label="Queue" className="min-w-0 rounded-xl border border-white/[0.06] bg-[#1A1A1A]/70 p-2">
        <p className="mb-1 px-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[#888888]">Queue</p>
        <div className="flex flex-nowrap items-center gap-1">
          <button type="button" aria-pressed={queueView === 'active'} onClick={() => handleQueueViewChange('active')} className={`min-h-9 whitespace-nowrap rounded-lg px-2.5 py-2 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F] ${queueView === 'active' ? 'bg-[#FF5A1F]/[0.09] text-[#FF5A1F]' : 'text-[#888888] hover:bg-[#242424] hover:text-white'}`}>Active ({activeCount})</button>
          <button type="button" aria-pressed={queueView === 'archived'} onClick={() => handleQueueViewChange('archived')} className={`min-h-9 whitespace-nowrap rounded-lg px-2.5 py-2 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F] ${queueView === 'archived' ? 'bg-[#FF5A1F]/[0.09] text-[#FF5A1F]' : 'text-[#888888] hover:bg-[#242424] hover:text-white'}`}>Archived ({archivedCount})</button>
        </div>
      </div>
    </div>
  );

  const archiveToastElement = archiveToast ? (
    <div role="status" className="fixed inset-x-4 top-6 sm:left-auto sm:right-6 z-[10000] rounded-xl border border-[#333] bg-[#121212] px-5 py-4 text-sm font-medium text-white shadow-2xl shadow-black/60">
      {archiveToast}
    </div>
  ) : null;

  if (!activeLead) {
    return (
      <div className="min-h-[70vh] bg-[#0A0A0A] border border-[#242424] rounded-2xl p-6">
          <div className="mb-6 space-y-3">
            <span className="text-xs font-mono text-[#888888] uppercase tracking-widest">
              {queueView === 'archived' ? 'ARCHIVE VAULT' : 'ACTIVE QUEUE'}
            </span>
            {queueTabs}
          </div>
          <div className="flex min-h-[55vh] flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 border border-[#242424] rounded-2xl flex items-center justify-center mb-6 bg-[#1A1A1A]">
              <Info className="w-6 h-6 text-[#FF5A1F]" />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-wide mb-2" style={{ fontFamily: 'Oxanium, sans-serif' }}>
              {needsReviewOnly ? 'NO REPLIES NEED REVIEW' : queueView === 'archived' ? 'ARCHIVE VAULT EMPTY' : 'NO ACTIVE TRIAGE SIGNALS'}
            </h2>
            <p className="text-gray-500 max-w-md" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              {needsReviewOnly ? 'No decision packets in this queue currently need review.' : queueView === 'archived'
                ? 'Rejected inbound signals will remain here until you permanently delete them.'
                : 'Awaiting campaign deployment and real inbound replies. New signals will appear here for review.'}
            </p>
            <div className="mt-6 flex flex-col items-center gap-2">
              {inboxActions}
              {inboxConnectionMessage && <p className="text-xs text-[#888888]">{inboxConnectionMessage}</p>}
            </div>
          </div>
          {connectInboxModal}
          {inboundSignalToast}
          {archiveToastElement}
      </div>
    );
  }

  const pageContent = (
    <div className="box-border flex min-h-dvh w-full max-w-full min-w-0 flex-col overflow-x-hidden overflow-y-auto pb-24 bg-[#0D0D0D] text-[#F5F1E8] font-sans">
      
      {/* QUEUE HEADER */}
      <div className="space-y-3 p-4 pb-0 shrink-0">
        <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest text-[#888888]">
          {queueView === 'archived' ? 'ARCHIVE VAULT' : 'ACTIVE QUEUE'}
        </span>
        <span className="bg-[#1A1A1A] border border-[#333] text-[#FF5A1F] font-mono text-[10px] px-2 py-0.5 rounded-sm">
          [ {visibleLeads.length} ]
        </span>
        </div>
        {queueTabs}
      </div>

      {/* HORIZONTAL QUEUE RIBBON (Top) */}
      <div className="w-full border-b border-[#1A1A1A] p-4 pb-4 flex gap-3 sm:gap-4 overflow-x-auto flex-nowrap shrink-0 snap-x snap-mandatory [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-[#0D0D0D] [&::-webkit-scrollbar-thumb]:bg-[#1A1A1A] hover:[&::-webkit-scrollbar-thumb]:bg-[#FF5A1F] [&::-webkit-scrollbar-thumb]:rounded-full">
        {visibleLeads.map(lead => (
          <button
            key={lead.id}
            type="button"
            aria-pressed={lead.id === activeLeadId}
            onClick={() => selectLead(lead)}
            className={`w-[82vw] min-w-[82vw] max-w-[300px] flex-shrink-0 snap-start p-3 text-left border rounded-md cursor-pointer transition-[border-color,background-color] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F] sm:w-[300px] sm:min-w-[300px] ${
              lead.id === activeLeadId ? 'border-[#FF5A1F] bg-[#242424]' : 'border-[#333333] bg-[#242424] hover:border-[#444444]'
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="min-w-0 break-words font-semibold text-sm" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{lead.name}</span>
              <span className={`shrink-0 font-mono text-[10px] px-2 py-0.5 rounded-sm ${
                isCoreTier ? 'bg-[#242424] text-gray-400' :
                lead.status === 'HOT' ? 'bg-[#FF5A1F]/10 text-[#FF5A1F]' : 
                lead.status === 'WARM' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-[#242424] text-gray-400'
              }`}>
                {isCoreTier ? 'REPLY' : lead.status}
              </span>
            </div>
            <p className="line-clamp-2 break-words text-xs text-muted-foreground" title={lead.inboundSignal}>{lead.inboundSignal}</p>
            {lead.decisionStatus && <p className="mt-2 text-[10px] font-mono uppercase">
              <span className="text-gray-500">Decision: </span>
              <span className={decisionStatusPresentation(lead.decisionStatus).tone}>{decisionStatusPresentation(lead.decisionStatus).label}</span>
            </p>}
            {isEnterpriseTier && lead.revenueRisk?.status === 'APPLICABLE' && <p className="mt-1 text-[10px] font-mono text-amber-300">Revenue priority: {lead.revenueRisk.score} · {lead.revenueRisk.band}</p>}
            {isEnterpriseTier && lead.revenueRisk?.status === 'NOT_APPLICABLE' && <p className="mt-1 text-[10px] text-gray-500">No revenue priority</p>}
            {isEnterpriseTier && lead.responseSLA && <p className={`mt-1 text-[10px] font-mono ${lead.responseSLA.status === 'BREACHED' || new Date(lead.responseSLA.dueAt).getTime() <= clock ? 'text-red-300' : 'text-gray-400'}`}>
              SLA: {displayResponseSLA({ status: lead.responseSLA.status,
                startedAt: new Date(lead.responseSLA.startedAt), dueAt: new Date(lead.responseSLA.dueAt),
                dueSoonPercent: slaDueSoonPercent }, new Date(clock)).state.replaceAll('_', ' ')}
            </p>}
          </button>
        ))}
      </div>

      {/* MAIN DETAIL VIEW (The Executive Override) */}
      <div className="box-border flex min-h-0 w-full max-w-full min-w-0 flex-1 flex-col overflow-y-auto p-4 md:p-8">
        <div key={activeLead?.id ?? 'empty'} className="lead-transition flex min-h-full w-full max-w-full min-w-0 flex-col">
        
        {/* Top Navigation / Status Bar */}
        <div className="flex flex-col md:flex-row md:justify-between items-start md:items-center mb-6 border-b border-[#1A1A1A] pb-5 gap-4 md:gap-0 shrink-0">
          <div>
            <h1 className="break-words text-xl font-bold tracking-wide text-white sm:text-2xl" style={{ fontFamily: 'Oxanium, sans-serif' }}>
              EXECUTIVE OVERRIDE QUEUE
            </h1>
            <p className="text-gray-500 mt-1 text-sm">
              {queueView === 'archived'
                ? `${visibleLeads.length} Archived Events`
                : `${visibleLeads.length} High-Priority Events Require Judgment`}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            {inboxActions}
            {inboxConnectionMessage && <p className="text-xs text-[#888888]">{inboxConnectionMessage}</p>}
          </div>
        </div>

        <DecisionPacketPanel key={activeLead.id} signalId={activeLead.id} reply={activeLead.inboundSignal} onDecision={updateDecisionStatus}
          onRisk={updateRevenueRisk} onSLA={updateResponseSLA} dueSoonPercent={slaDueSoonPercent} isEnterpriseTier={isEnterpriseTier} />

        <div className="mt-6 flex flex-1 flex-col gap-6 xl:flex-row xl:gap-12">
          
          {/* LEFT PANE: The Context Engine (40%) */}
          <div className="w-full xl:w-2/5 flex flex-col space-y-8">
          
          {/* Prospect Identity & Metrics */}
          <div className="rounded-lg border border-gray-800 bg-[#121212] p-5 shadow-2xl sm:p-8">
            <h2 className="text-xs text-gray-500 uppercase tracking-widest mb-4" style={{ fontFamily: 'Oxanium, sans-serif' }}>Entity Context</h2>
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white">{PROSPECT_NAME}</h3>
              <p className="text-gray-400">{PROSPECT_COMPANY}</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-800 pt-6">
              <div>
                <p className="text-xs text-gray-500 uppercase">Pipeline Value</p>
                <p className="text-lg font-medium text-white mt-1">{activeLead?.pipelineValue}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Deal Stage</p>
                <p className="text-lg font-medium text-white mt-1">{activeLead?.dealStage || 'Not specified'}</p>
              </div>
            </div>
          </div>

          {/* Inbound Raw Message */}
          <div className="flex-grow rounded-lg border border-gray-800 bg-[#121212] p-5 sm:p-8">
            <h2 className="text-xs text-gray-500 uppercase tracking-widest mb-4" style={{ fontFamily: 'Oxanium, sans-serif' }}>Inbound Signal</h2>
            <div className="prose prose-invert max-w-none text-gray-300 text-sm leading-relaxed" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              <p className="text-gray-500 mb-4">
                Received: {activeLead?.createdAt ? new Date(activeLead.createdAt).toLocaleString() : 'Unknown'}
              </p>
              <div className="whitespace-pre-wrap">
                {inboundSignal}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANE: The Cognitive Architecture (60%) */}
        <div className="w-full xl:w-3/5 flex flex-col">
          {/* Right Side Main Column */}
          <div className="w-full flex flex-col gap-6 h-full">

            {/* TOP ROW: Intent & Strategy (Stacked on mobile, Side-by-Side on Desktop) */}
            <div className="w-full grid grid-cols-1 gap-6">
              
              {/* Intent Intelligence Widget */}
              <div className="w-full bg-[#1a1a1a] border border-gray-800 p-6 rounded-md shadow-md">
                <div className="flex justify-between items-end mb-4">
                  <div>
                    <h4 className="text-xs text-gray-500 uppercase tracking-widest mb-1" style={{ fontFamily: 'Oxanium, sans-serif' }}>Intent Score</h4>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold text-white">{displayedIntentScore}</span>
                      <span className="text-sm font-medium text-gray-400">/ 100</span>
                    </div>
                  </div>
                  <div className={`text-sm font-bold tracking-widest uppercase ${displayedIntentScore >= 71 ? 'text-green-500' : displayedIntentScore >= 31 ? 'text-yellow-500' : 'text-red-500'}`} style={{ fontFamily: 'Oxanium, sans-serif' }}>
                    {temperature}
                  </div>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5 mb-6">
                  <div className={`h-1.5 rounded-full transition-all duration-1000 ${getProgressBarColor(displayedIntentScore)}`} style={{ width: `${displayedIntentScore}%` }}></div>
                </div>
                
                <div>
                  <h4 className="text-[10px] text-gray-500 uppercase tracking-widest mb-3" style={{ fontFamily: 'Oxanium, sans-serif' }}>Why Now / Signals</h4>
                  <div className="flex flex-wrap gap-2">
                    {displayedSignals.map((signal, index) => (
                      <span key={`${activeLead?.id ?? 'lead'}-${signal}-${index}`} className={`rounded-full border px-3 py-1 text-xs ${
                        signal.toLowerCase() === 'pricing inquiry'
                          ? 'border-white/[0.12] bg-[#1A1A1A] text-white/80'
                          : /discount/i.test(signal)
                            ? 'border-[#FF5A1F]/25 bg-[#FF5A1F]/[0.06] text-[#FF9A73]'
                            : 'border-white/[0.08] bg-[#1A1A1A] text-[#888888]'
                      }`}>
                        {signal}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

            </div>

            {/* BOTTOM ROW: Draft Response & Buttons (Full Width) */}
              <div className="relative flex h-auto min-h-min w-full flex-col gap-3 overflow-visible">
              
              {/* 1. Header */}
              <div className="flex items-center justify-between w-full">
                <h3 className="text-[10px] font-bold text-white/50 tracking-widest uppercase">Draft Response</h3>
                <button 
                  type="button" 
                  onClick={() => setIsEditing(!isEditing)}
                  disabled={isGenerating || isDispatching}
                  className="inline-flex min-h-11 items-center px-3 py-2 text-xs bg-[#1A1A1A] text-white rounded hover:bg-[#222]"
                >
                  {isEditing ? 'Lock Draft' : 'Unlock Edit Mode'}
                </button>
              </div>

              {/* 2. The Textarea (Unconstrained, fully visible) */}
              <textarea
                className="w-full min-h-[180px] h-auto bg-transparent border border-[#1A1A1A] rounded-lg p-4 text-sm text-white resize-y focus:outline-none focus:border-[#FF4F00]"
                value={typeof draftText === 'object' && draftText !== null ? draftText.body || '' : draftText || ''}
                onChange={(e) => {
                  if (typeof draftText === 'object' && draftText !== null) {
                    setDraftText({ ...draftText, body: e.target.value });
                  } else {
                    setDraftText(e.target.value);
                  }
                }}
                placeholder="Awaiting Triage Draft..."
              />

              {regenerateError && (
                <p className="text-xs text-red-400">{regenerateError}</p>
              )}

              {/* 3. The CTA Text (Directly below textarea) */}
              <p className="w-full text-[11px] leading-relaxed text-muted-foreground whitespace-normal break-words px-1">
                <span className="text-[#FF4F00] mr-1">●</span> CTA defaults to your Campaign Context preference. Edit this draft anytime before approving.
              </p>

              {/* 4. The Separator Line */}
              <div className="w-full h-px bg-[#1A1A1A] my-2"></div>

              {/* 5. The Action Buttons (Stacked natively at the bottom) */}
              <div className="sticky bottom-0 z-20 -mx-4 flex w-[calc(100%+2rem)] flex-col gap-3 border-t border-[#1A1A1A] bg-[#0D0D0D]/95 p-4 backdrop-blur-md md:static md:mx-0 md:w-full md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
                {queueView === 'archived' ? (
                  <button
                    type="button"
                    onClick={handlePermanentDelete}
                    disabled={deletingArchivedId === activeLead.id}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 py-3 text-sm font-bold text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingArchivedId === activeLead.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                    {deletingArchivedId === activeLead.id ? 'Deleting...' : 'Permanently Delete'}
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={handleArchive} disabled={isGenerating || isDispatching || isBooking || isArchiving} className="w-full py-3 text-sm text-white/50 hover:text-white transition-colors disabled:opacity-50">
                      {isArchiving ? 'Archiving...' : 'Reject & Archive'}
                    </button>
                    <button type="button" onClick={handleRegenerate} disabled={!hasDecisionEngineAccess || isGenerating || isDispatching || isBooking || isArchiving} className="w-full py-3 text-sm font-bold bg-[#1A1A1A] text-white rounded-lg hover:bg-[#222] disabled:cursor-not-allowed disabled:opacity-50">
                      {!hasDecisionEngineAccess ? 'Decision Engine unavailable' : isGenerating ? 'Drafting...' : 'Regenerate Draft'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDispatch()}
                      disabled={isGenerating || isDispatching || isBooking || isArchiving}
                      className="w-full py-3 text-sm font-bold bg-[#FF4F00] text-white rounded-lg hover:bg-[#ff6a00]"
                    >
                      {isDispatching ? 'Sending...' : 'Approve & Send'}
                    </button>

                    {isHotLead && (
                      <button type="button" onClick={() => setShowBookingModal(true)} disabled={isGenerating || isDispatching || isBooking || isArchiving} className="w-full py-3 text-sm font-bold border border-[#FF4F00] text-[#FF4F00] rounded-lg hover:bg-[#FF4F00]/10 flex items-center justify-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        {isBooking ? 'Locking...' : 'Lock Meeting & Dispatch'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

          </div>
        </div>
        </div>
      </div>
    </div>
  </div>
);

return (
    <>
      {/* Booking Confirmation Modal */}
      {showBookingModal && (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95 w-full h-full p-4 overflow-y-auto">
          <div className="bg-[#121212] border border-gray-800 rounded-2xl p-8 w-full max-w-sm mx-auto shadow-2xl my-auto">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-[#FF5A1F]/10 rounded-lg">
                <CalendarCheck className="w-5 h-5 text-[#FF5A1F]" />
              </div>
              <div>
                <h3 className="text-white font-bold text-base" style={{ fontFamily: 'Oxanium, sans-serif' }}>ZERO-CLICK CONCIERGE</h3>
                <p className="text-gray-500 text-xs mt-0.5">Confirm meeting window for {PROSPECT_NAME}</p>
              </div>
            </div>

            {/* Quick Fill Slot Pills */}
            {availableSlots.length > 0 && (
              <div className="mb-5">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2" style={{ fontFamily: 'Oxanium, sans-serif' }}>Quick Fill — Available Slots</p>
                <div className="flex flex-wrap gap-2">
                  {availableSlots.slice(0, 4).map((slot, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        // Parse the human-readable slot label → strict ISO string
                        const isoStart = parseSlotLabel(slot);
                        if (isoStart) {
                          setBookingSlotStart(isoStart);
                          // Auto-calculate end = start + 20 minutes
                          const endDate = new Date(isoStart);
                          endDate.setMinutes(endDate.getMinutes() + 20);
                          setBookingSlotEnd(endDate.toISOString());
                        }
                        // If unparseable, do nothing — user sets via CalendarPicker
                      }}
                      className="px-3 py-1.5 bg-[#242424] hover:bg-[#333] text-[#FF5A1F] border border-[#FF5A1F]/20 hover:border-[#FF5A1F]/50 rounded-full text-[11px] font-medium transition-all"
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-5 mb-6">
              <CalendarPicker
                label="Start Time"
                value={bookingSlotStart || null}
                onChange={(iso) => {
                  setBookingSlotStart(iso);
                  if (bookingSlotEnd) {
                    const start = new Date(iso);
                    start.setMinutes(start.getMinutes() + 20);
                    setBookingSlotEnd(start.toISOString());
                  }
                }}
                synced={availableSlots.length > 0}
              />
              <CalendarPicker
                label="End Time"
                value={bookingSlotEnd || null}
                onChange={setBookingSlotEnd}
                synced={availableSlots.length > 0}
              />
              {bookingError && (
                <p className="text-xs text-red-400">{bookingError}</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowBookingModal(false); setBookingError(''); }}
                className="flex-1 py-2.5 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLockMeeting}
                disabled={isBooking || !bookingSlotStart || !bookingSlotEnd}
                className="flex-1 py-2.5 text-xs font-semibold bg-[#FF5A1F] hover:bg-[#FF5A1F]/90 text-white rounded shadow-lg shadow-[#FF5A1F]/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isBooking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarCheck className="w-3.5 h-3.5" />}
                {isBooking ? 'Locking...' : 'Confirm & Lock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast */}
      {bookingSuccess && (
        <div className="fixed inset-x-4 top-6 sm:left-auto sm:right-6 z-50 flex items-center gap-3 px-5 py-4 bg-[#121212] border border-green-500/30 rounded-xl shadow-2xl shadow-green-500/10 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="p-1.5 bg-green-500/10 rounded-full">
            <CalendarCheck className="w-4 h-4 text-green-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Meeting Locked.</p>
            <p className="text-xs text-gray-400 mt-0.5">Invite sent via Google Calendar.</p>
          </div>
        </div>
      )}

      {/* Dispatch Success Toast */}
      {dispatchSuccess && (
        <div className="fixed inset-x-4 top-6 sm:left-auto sm:right-6 z-50 flex items-center gap-3 px-5 py-4 bg-[#121212] border border-[#FF5A1F]/30 rounded-xl shadow-2xl shadow-[#FF5A1F]/10 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="p-1.5 bg-[#FF5A1F]/10 rounded-full">
            <svg className="w-4 h-4 text-[#FF5A1F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Reply Dispatched & Queued.</p>
            <p className="text-xs text-gray-400 mt-0.5">Outbound hook triggered successfully.</p>
          </div>
        </div>
      )}

      {connectInboxModal}
      {inboundSignalToast}
      {archiveToastElement}
      {pageContent}
      <style jsx>{`
        @keyframes leadTransitionIn {
          from { opacity: 0.82; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .lead-transition { animation: leadTransitionIn 200ms cubic-bezier(.2,.75,.25,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .lead-transition { animation: none; }
        }
      `}</style>
    </>
  );
}
