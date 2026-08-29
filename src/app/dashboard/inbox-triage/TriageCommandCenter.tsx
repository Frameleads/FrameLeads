'use client';

import { useState, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Info, CalendarCheck, Mail, Trash2, X, Lock as LockIcon } from 'lucide-react';
import CalendarPicker from '@/components/CalendarPicker';
import { playUISound } from '@/lib/audio';
import { ENTERPRISE_CHECKOUT_URL } from '@/lib/checkout';

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

function EnterpriseFeatureGate({ locked, children }: { locked: boolean; children: ReactNode }) {
  if (!locked) return <>{children}</>;

  return (
    <div className="relative">
      <div className="filter blur-md opacity-40 pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
        <LockIcon className="w-8 h-8 text-[#FF5A1F] mb-4" />
        <button
          type="button"
          onClick={() => window.open(ENTERPRISE_CHECKOUT_URL, '_blank', 'noopener,noreferrer')}
          className="bg-[#FF5A1F] hover:bg-[#e5511c] text-white font-semibold px-6 py-3 rounded-lg transition-all shadow-[0_0_15px_rgba(255,90,31,0.4)] border-none"
        >
          Upgrade to Enterprise to Unlock AI Intent Scoring
        </button>
      </div>
    </div>
  );
}

export default function TriageCommandCenter({
  initialData,
  userTier,
}: {
  initialData: any;
  userTier: string;
}) {
  const router = useRouter();
  const isCoreTier = userTier === 'CORE';
  const hasInboxAccess = userTier === 'CORE' || userTier === 'ENTERPRISE';
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
        strategyLogic: s.signalAnalysis || "Awaiting strategy logic..."
      }))
    : [], [initialData]);

  const [leads, setLeads] = useState<any[]>(dbLeads);
  const [queueView, setQueueView] = useState<'active' | 'archived'>('active');
  const visibleLeads = leads.filter((lead) =>
    queueView === 'archived' ? lead.recordStatus === 'ARCHIVED' : lead.recordStatus === 'PENDING',
  );
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
  const [temperature, setTemperature] = useState(activeLead ? (activeLead.status === 'HOT' ? '🔥 HOT' : activeLead.status === 'WARM' ? '☀️ WARM' : '❄️ COLD') : '');
  const [signals, setSignals] = useState<string[]>(activeLead ? activeLead.signals : []);
  const [strategyLogic, setStrategyLogic] = useState(activeLead ? activeLead.strategyLogic : '');
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
    if (activeLead) {
      setInboundSignal(activeLead.inboundSignal);
      setDraftText(activeLead.draftText);
      setIntentScore(activeLead.intentScore);
      setTemperature(activeLead.status === 'HOT' ? '🔥 HOT' : activeLead.status === 'WARM' ? '☀️ WARM' : '❄️ COLD');
      setSignals(activeLead.signals);
      setStrategyLogic(activeLead.strategyLogic);
    }
  }, [activeLeadId, activeLead]);

  // Concierge slots returned by the triage AI (populated after Regenerate)
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);

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
          setStrategyLogic(typeof data.strategy === 'string' ? data.strategy : '');
          setDraftText(typeof data.draftResponse === 'string' ? data.draftResponse : 'Awaiting Triage Draft...');
          setLeads((current) => current.map((lead) => lead.id === activeLead?.id
            ? {
                ...lead,
                intentScore: data.intentScore,
                status: data.category,
                signals: Array.isArray(data.signals) ? data.signals : [],
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
        setActiveLeadId(newLeads.find((lead) => lead.recordStatus === 'PENDING')?.id || null);
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
  const isHotLead = !isCoreTier && intentScore >= 71;

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
        setActiveLeadId(newLeads.find((lead) => lead.recordStatus === 'PENDING')?.id || null);
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
    setActiveLeadId(
      leads.find((lead) => view === 'archived'
        ? lead.recordStatus === 'ARCHIVED'
        : lead.recordStatus === 'PENDING')?.id || null,
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
      setActiveLeadId(updatedLeads.find((lead) => lead.recordStatus === 'PENDING')?.id || null);
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
      setActiveLeadId(remainingLeads.find((lead) => lead.recordStatus === 'ARCHIVED')?.id || null);
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
          className="fixed right-6 top-6 z-[10000] rounded-xl border border-[#FF5A1F]/30 bg-[#121212] px-5 py-4 text-sm font-semibold text-white shadow-2xl shadow-[#FF5A1F]/10 animate-in fade-in slide-in-from-top-2 duration-300"
        >
          🔥 New inbound signal detected!
        </div>,
        document.body,
      )
    : null;

  const activeCount = leads.filter((lead) => lead.recordStatus === 'PENDING').length;
  const archivedCount = leads.filter((lead) => lead.recordStatus === 'ARCHIVED').length;
  const queueTabs = (
    <div className="inline-flex rounded-lg border border-[#242424] bg-[#121212] p-1">
      <button
        type="button"
        onClick={() => handleQueueViewChange('active')}
        className={`rounded-md px-4 py-2 text-xs font-semibold transition-colors ${
          queueView === 'active' ? 'bg-[#FF5A1F] text-white' : 'text-[#888888] hover:text-white'
        }`}
      >
        Active ({activeCount})
      </button>
      <button
        type="button"
        onClick={() => handleQueueViewChange('archived')}
        className={`rounded-md px-4 py-2 text-xs font-semibold transition-colors ${
          queueView === 'archived' ? 'bg-[#FF5A1F] text-white' : 'text-[#888888] hover:text-white'
        }`}
      >
        Archived ({archivedCount})
      </button>
    </div>
  );

  const archiveToastElement = archiveToast ? (
    <div role="status" className="fixed top-6 right-6 z-[10000] rounded-xl border border-[#333] bg-[#121212] px-5 py-4 text-sm font-medium text-white shadow-2xl shadow-black/60">
      {archiveToast}
    </div>
  ) : null;

  if (!activeLead) {
    return (
      <div className="min-h-[70vh] bg-[#0A0A0A] border border-[#242424] rounded-2xl p-6">
          <div className="mb-8 flex items-center justify-between gap-4">
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
              {queueView === 'archived' ? 'ARCHIVE VAULT EMPTY' : 'NO ACTIVE TRIAGE SIGNALS'}
            </h2>
            <p className="text-gray-500 max-w-md" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              {queueView === 'archived'
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
    <div className="flex flex-col min-h-screen overflow-x-hidden overflow-y-auto pb-24 bg-[#0D0D0D] text-[#F5F1E8] font-sans">
      
      {/* QUEUE HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 pb-0 shrink-0">
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
          <div
            key={lead.id}
            onClick={() => setActiveLeadId(lead.id)}
            className={`w-[82vw] min-w-[82vw] max-w-[300px] flex-shrink-0 snap-start p-3 border rounded-md cursor-pointer transition-colors sm:w-[300px] sm:min-w-[300px] ${
              lead.id === activeLeadId ? 'border-[#FF5A1F] bg-[#141414]' : 'border-[#1A1A1A] hover:bg-[#1A1A1A]'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{lead.name}</span>
              <span className={`font-mono text-[10px] px-2 py-0.5 rounded-sm ${
                isCoreTier ? 'bg-[#242424] text-gray-400' :
                lead.status === 'HOT' ? 'bg-[#FF5A1F]/10 text-[#FF5A1F]' : 
                lead.status === 'WARM' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-[#242424] text-gray-400'
              }`}>
                {isCoreTier ? 'REPLY' : lead.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground truncate">{lead.inboundSignal}</p>
          </div>
        ))}
      </div>

      {/* MAIN DETAIL VIEW (The Executive Override) */}
      <div className="flex-1 w-full overflow-y-auto p-4 md:p-8 flex flex-col">
        
        {/* Top Navigation / Status Bar */}
        <div className="flex flex-col md:flex-row md:justify-between items-start md:items-center mb-12 border-b border-[#1A1A1A] pb-6 gap-4 md:gap-0 shrink-0">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-wide" style={{ fontFamily: 'Oxanium, sans-serif' }}>
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

        <div className="flex flex-1 flex-col gap-6 xl:flex-row xl:gap-12">
          
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
            <EnterpriseFeatureGate locked={isCoreTier}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Intent Intelligence Widget */}
              <div className="w-full bg-[#1a1a1a] border border-gray-800 p-6 rounded-md shadow-md">
                <div className="flex justify-between items-end mb-4">
                  <div>
                    <h4 className="text-xs text-gray-500 uppercase tracking-widest mb-1" style={{ fontFamily: 'Oxanium, sans-serif' }}>Intent Score</h4>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold text-white">{intentScore}</span>
                      <span className="text-sm font-medium text-gray-400">/ 100</span>
                    </div>
                  </div>
                  <div className={`text-sm font-bold tracking-widest uppercase ${intentScore >= 71 ? 'text-green-500' : intentScore >= 31 ? 'text-yellow-500' : 'text-red-500'}`} style={{ fontFamily: 'Oxanium, sans-serif' }}>
                    {temperature}
                  </div>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5 mb-6">
                  <div className={`h-1.5 rounded-full transition-all duration-1000 ${getProgressBarColor(intentScore)}`} style={{ width: `${intentScore}%` }}></div>
                </div>
                
                <div>
                  <h4 className="text-[10px] text-gray-500 uppercase tracking-widest mb-3" style={{ fontFamily: 'Oxanium, sans-serif' }}>Why Now / Signals</h4>
                  <div className="flex flex-wrap gap-2">
                    {signals.map((signal, index) => (
                      <span key={index} className="px-3 py-1 text-xs border border-[#242424] rounded-full text-[#888888] bg-[#111111]">
                        {signal}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Strategy Note */}
              <div className="w-full bg-[#1a1a1a] border border-gray-800 p-4 rounded-md transition-opacity duration-500">
                <h4 className="text-xs text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-2" style={{ fontFamily: 'Oxanium, sans-serif' }}>
                  <span className={`w-2 h-2 rounded-full inline-block ${isGenerating ? 'bg-yellow-500 animate-pulse' : 'bg-orange-600'}`}></span>
                  Claude Strategy Logic
                </h4>
                <p className="text-sm text-gray-400 italic">
                  {isGenerating 
                    ? "Re-evaluating context vectors. Generating structural reframe..." 
                    : strategyLogic}
                </p>
              </div>

            </div>
            </EnterpriseFeatureGate>

            {/* BOTTOM ROW: Draft Response & Buttons (Full Width) */}
              <div className="relative flex h-auto min-h-min w-full flex-col gap-3 overflow-visible">
              
              {/* 1. Header */}
              <div className="flex items-center justify-between w-full">
                <h3 className="text-[10px] font-bold text-white/50 tracking-widest uppercase">Draft Response</h3>
                <button 
                  type="button" 
                  onClick={() => setIsEditing(!isEditing)}
                  disabled={isGenerating || isDispatching}
                  className="px-3 py-1.5 text-xs bg-[#1A1A1A] text-white rounded hover:bg-[#222]"
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
                    <button type="button" onClick={handleRegenerate} disabled={isCoreTier || isGenerating || isDispatching || isBooking || isArchiving} className="w-full py-3 text-sm font-bold bg-[#1A1A1A] text-white rounded-lg hover:bg-[#222] disabled:cursor-not-allowed disabled:opacity-50">
                      {isCoreTier ? 'Enterprise Required for Claude Classification' : isGenerating ? 'Drafting...' : 'Regenerate Draft'}
                    </button>
                    <button
                      type="button"
                      onClick={() => isCoreTier ? window.open(ENTERPRISE_CHECKOUT_URL, '_blank', 'noopener,noreferrer') : void handleDispatch()}
                      disabled={isGenerating || isDispatching || isBooking || isArchiving}
                      className={isCoreTier
                        ? "bg-[#FF5A1F] hover:bg-[#e5511c] text-white font-semibold px-6 py-3 rounded-lg transition-all shadow-[0_0_15px_rgba(255,90,31,0.4)] border-none"
                        : "w-full py-3 text-sm font-bold bg-[#FF4F00] text-white rounded-lg hover:bg-[#ff6a00]"}
                    >
                      {isCoreTier ? 'Upgrade to Enterprise to Approve & Send' : isDispatching ? 'Sending...' : 'Approve & Send'}
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
        <div className="fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-4 bg-[#121212] border border-green-500/30 rounded-xl shadow-2xl shadow-green-500/10 animate-in fade-in slide-in-from-top-2 duration-300">
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
        <div className="fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-4 bg-[#121212] border border-[#FF5A1F]/30 rounded-xl shadow-2xl shadow-[#FF5A1F]/10 animate-in fade-in slide-in-from-top-2 duration-300">
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
    </>
  );
}
