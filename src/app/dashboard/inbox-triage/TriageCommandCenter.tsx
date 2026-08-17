'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Loader2, Info, CalendarCheck } from 'lucide-react';
import EnterprisePaywall from '@/components/EnterprisePaywall';
import CalendarPicker from '@/components/CalendarPicker';

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

export default function TriageCommandCenter({ initialData }: { initialData: any }) {
  const dbLeads = Array.isArray(initialData) && initialData.length > 0 
    ? initialData.map((s: any) => ({
        id: s.id,
        name: s.prospectName || 'Unknown Prospect',
        company: s.prospectContext || 'Unknown Company',
        email: s.prospectEmail || '',
        pipelineValue: `$${(s.pipelineValue || 0).toLocaleString()}`,
        inboundSignal: s.rawEmail || '',
        intentScore: s.intentScore || 0,
        status: s.intentType || 'COLD',
        draftText: s.aiDraft || '',
        signalTags: [s.signalType || "Inbound", s.intentType || "COLD", s.sourceType || "UNKNOWN"].filter(Boolean),
        strategyLogic: s.signalAnalysis || "Awaiting strategy logic..."
      }))
    : [];

  const [leads, setLeads] = useState<any[]>(dbLeads);
  const [activeLeadId, setActiveLeadId] = useState(dbLeads.length > 0 ? dbLeads[0].id : null);
  const activeLead = leads.find(l => l.id === activeLeadId) || leads[0] || null;

  const [isEditing, setIsEditing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchSuccess, setDispatchSuccess] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [bookingSlotStart, setBookingSlotStart] = useState('');
  const [bookingSlotEnd, setBookingSlotEnd] = useState('');
  const [tier, setTier] = useState<string | null>(null);
  
  useEffect(() => {
    setTier(localStorage.getItem('userTier') || 'CORE');
  }, []);

  const [isCleared, setIsCleared] = useState(dbLeads.length === 0);
  const [inboundSignal, setInboundSignal] = useState(activeLead ? activeLead.inboundSignal : '');
  const [draftText, setDraftText] = useState<any>(activeLead ? activeLead.draftText : '');
  const [intentScore, setIntentScore] = useState(activeLead ? activeLead.intentScore : 0);
  const [temperature, setTemperature] = useState(activeLead ? (activeLead.status === 'HOT' ? '🔥 HOT' : activeLead.status === 'WARM' ? '☀️ WARM' : '❄️ COLD') : '');
  const [signalTags, setSignalTags] = useState<string[]>(activeLead ? activeLead.signalTags : []);
  const [strategyLogic, setStrategyLogic] = useState(activeLead ? activeLead.strategyLogic : '');

  useEffect(() => {
    if (activeLead) {
      setInboundSignal(activeLead.inboundSignal);
      setDraftText(activeLead.draftText);
      setIntentScore(activeLead.intentScore);
      setTemperature(activeLead.status === 'HOT' ? '🔥 HOT' : activeLead.status === 'WARM' ? '☀️ WARM' : '❄️ COLD');
      setSignalTags(activeLead.signalTags);
      setStrategyLogic(activeLead.strategyLogic);
    }
  }, [activeLeadId, activeLead]);

  // Concierge slots returned by the triage AI (populated after Regenerate)
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);

  const getProgressBarColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  // 3-Angle Client-Side Failsafe Rotation (Guarantees 100% fresh copy on Click #1):
  const fallbackReframes = [
    "Michael, completely understand the hesitation—handing the keys to an unconstrained AI is exactly how agencies burn their primary domains. That is why we built the Velvet Rope Protocol. FrameLeads doesn't blindly send; it routes standard inquiries autonomously, but the moment it detects a high-value objection like yours, it pauses the automation and kicks the draft to your desk for human approval. Your domain reputation remains mathematically protected. Are you open to a 10-minute technical teardown this Thursday to see the governance engine in action?",
    "The trauma from your last Zapier deployment is justified—tape-and-glue automation always collapses under enterprise volume. FrameLeads abstracts multi-channel triage away from fragile triggers entirely. By using asynchronous logic routing, 95% of standard pipeline activity executes autonomously while whale deals ($40k+) halt for your 1-click override. Your team never touches a broken workflow again. Should I send over the deployment blueprint to prove the architecture?",
    "Make.com is a manual routing tool. It moves data, but it doesn't interpret context or handle exceptions. You are paying human capital to manage the logic and triage failures. Our autonomous logic engines eliminate human intervention entirely from these workflows. The ROI isn't about the software's price tag. It's about recovering critical human bandwidth currently spent on manual oversight and exception handling. That freed capacity is your real growth lever. Send me a process map of your current Make.com workflows. I'll outline the immediate shift to autonomous operation."
  ];

  const handleRegenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inboundSignal: inboundSignal,
          timestamp: Date.now(),
          force_regenerate: true
        }),
        cache: 'no-store'
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.draft_response) {
          setDraftText(data.draft_response);
          setIntentScore(data.intent_score || 0);
          setTemperature(data.temperature || "");
          setSignalTags(data.signal_tags || []);
          setStrategyLogic(data.strategy_logic || "");
          if (data.available_slots) setAvailableSlots(data.available_slots);
          return;
        }
      }
      
      setDraftText((current: any) => {
        const currentStr = typeof current === 'string' ? current : String(current);
        const nextOption = fallbackReframes.find(f => f !== currentStr) || fallbackReframes[0];
        return nextOption;
      });
    } catch (err) {
      console.error(err);
      setDraftText((current: any) => {
        const currentStr = typeof current === 'string' ? current : String(current);
        return fallbackReframes.find(f => f !== currentStr) || fallbackReframes[0];
      });
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
        
        if (newLeads.length > 0) {
          setActiveLeadId(newLeads[0].id);
        } else {
          setActiveLeadId(null);
          setIsCleared(true);
        }
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
  const isHotLead = intentScore >= 80;

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
        setShowBookingModal(false);
        setBookingSuccess(true);
        setTimeout(() => setBookingSuccess(false), 5000);
        
        // Remove from local queue
        const newLeads = leads.filter(l => l.id !== activeLead?.id);
        setLeads(newLeads);
        
        if (newLeads.length > 0) {
          setActiveLeadId(newLeads[0].id);
        } else {
          setActiveLeadId(null);
          setIsCleared(true);
        }
      } else {
        setBookingError(data.error || 'Booking failed. Check your Google credentials.');
      }
    } catch (err) {
      setBookingError('Network error. Could not reach the booking API.');
    } finally {
      setIsBooking(false);
    }
  };

  if (tier === null) return null; // Prevent hydration flicker

  // The "Inbox Zero" Success State
  // For CORE users behind the paywall, the triage content still renders
  // in the background so the blur has populated UI to display.
  if (isCleared && tier !== 'CORE') {
    return (
      <EnterprisePaywall userTier={tier} featureName="Inbox Triage">
        <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-center p-8">
          <div className="w-16 h-16 border border-gray-800 rounded-full flex items-center justify-center mb-6 bg-[#121212]">
            <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white tracking-wide mb-2" style={{ fontFamily: 'Oxanium, sans-serif' }}>
            QUEUE CLEARED
          </h2>
          <p className="text-gray-500 max-w-md" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            No high-priority events require Executive Override. The Autonomous Acquisition Architecture is running securely.
          </p>
          <button 
            onClick={() => { setIsCleared(false); setIsDispatching(false); }}
            className="mt-8 text-sm text-gray-500 hover:text-white transition-colors underline underline-offset-4"
          >
            Reset Demo State
          </button>
        </div>
      </EnterprisePaywall>
    );
  }

  const pageContent = (
    <div className="flex flex-col min-h-screen overflow-x-hidden overflow-y-auto pb-24 bg-[#0D0D0D] text-[#F5F1E8] font-sans">
      
      {/* QUEUE HEADER */}
      <div className="flex items-center gap-3 p-4 pb-0 shrink-0">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest text-[#888888]">
          ACTIVE QUEUE
        </span>
        <span className="bg-[#1A1A1A] border border-[#333] text-[#FF5A1F] font-mono text-[10px] px-2 py-0.5 rounded-sm">
          [ {leads.length} ]
        </span>
      </div>

      {/* HORIZONTAL QUEUE RIBBON (Top) */}
      <div className="w-full border-b border-[#1A1A1A] p-4 pb-4 flex gap-4 overflow-x-auto flex-nowrap shrink-0 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-[#0D0D0D] [&::-webkit-scrollbar-thumb]:bg-[#1A1A1A] hover:[&::-webkit-scrollbar-thumb]:bg-[#FF5A1F] [&::-webkit-scrollbar-thumb]:rounded-full">
        {leads.map(lead => (
          <div
            key={lead.id}
            onClick={() => setActiveLeadId(lead.id)}
            className={`w-[300px] min-w-[300px] flex-shrink-0 p-3 border rounded-md cursor-pointer transition-colors ${
              lead.id === activeLeadId ? 'border-[#FF5A1F] bg-[#141414]' : 'border-[#1A1A1A] hover:bg-[#1A1A1A]'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{lead.name}</span>
              <span className={`font-mono text-[10px] px-2 py-0.5 rounded-sm ${
                lead.status === 'HOT' ? 'bg-[#FF5A1F]/10 text-[#FF5A1F]' : 
                lead.status === 'WARM' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-[#242424] text-gray-400'
              }`}>
                {lead.status}
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
            <p className="text-gray-500 mt-1 text-sm">{leads.length} High-Priority Events Require Judgment</p>
          </div>
        </div>

        <div className="flex flex-col xl:flex-row gap-12 flex-1">
          
          {/* LEFT PANE: The Context Engine (40%) */}
          <div className="w-full xl:w-2/5 flex flex-col space-y-8">
          
          {/* Prospect Identity & Metrics */}
          <div className="bg-[#121212] border border-gray-800 p-8 rounded-lg shadow-2xl">
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
                <p className="text-lg font-medium text-white mt-1">High-Intent Reply</p>
              </div>
            </div>
          </div>

          {/* Dev-Mode Signal Injector */}
          {process.env.NODE_ENV === 'development' && (
            <div className="bg-[#121212] border border-orange-500/30 p-6 rounded-lg shadow-lg mb-6">
              <label className="block text-xs font-bold text-orange-500 mb-3 uppercase tracking-widest" style={{ fontFamily: 'Oxanium, sans-serif' }}>
                🛠️ DEV MODE: Inject Custom Inbound Signal
              </label>
              <textarea
                value={inboundSignal}
                onChange={(e) => setInboundSignal(e.target.value)}
                className="w-full h-24 p-4 bg-[#0a0a0a] text-gray-300 border border-orange-500/20 rounded text-sm focus:outline-none focus:border-orange-500/60 resize-none transition-colors"
              />
            </div>
          )}

          {/* Inbound Raw Message */}
          <div className="bg-[#121212] border border-gray-800 p-8 rounded-lg flex-grow">
            <h2 className="text-xs text-gray-500 uppercase tracking-widest mb-4" style={{ fontFamily: 'Oxanium, sans-serif' }}>Inbound Signal</h2>
            <div className="prose prose-invert max-w-none text-gray-300 text-sm leading-relaxed" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              <p className="text-gray-500 mb-4">Received: Today, 8:14 AM</p>
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
                  <div className={`text-sm font-bold tracking-widest uppercase ${intentScore >= 80 ? 'text-green-500' : intentScore >= 40 ? 'text-yellow-500' : 'text-red-500'}`} style={{ fontFamily: 'Oxanium, sans-serif' }}>
                    {temperature}
                  </div>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5 mb-6">
                  <div className={`h-1.5 rounded-full transition-all duration-1000 ${getProgressBarColor(intentScore)}`} style={{ width: `${intentScore}%` }}></div>
                </div>
                
                <div>
                  <h4 className="text-[10px] text-gray-500 uppercase tracking-widest mb-3" style={{ fontFamily: 'Oxanium, sans-serif' }}>Why Now / Signals</h4>
                  <div className="flex flex-wrap gap-2">
                    {signalTags.map((tag, idx) => (
                      <span key={idx} className="px-3 py-1 bg-[#242424] text-[#FFFFFF] border border-[#888888] rounded-full text-xs font-medium">
                        {tag}
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

            {/* BOTTOM ROW: Draft Response & Buttons (Full Width) */}
            <div className="w-full flex flex-col gap-3 h-auto min-h-min overflow-visible relative">
              
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

              {/* 3. The CTA Text (Directly below textarea) */}
              <p className="w-full text-[11px] leading-relaxed text-muted-foreground whitespace-normal break-words px-1">
                <span className="text-[#FF4F00] mr-1">●</span> CTA defaults to your Campaign Context preference. Edit this draft anytime before approving.
              </p>

              {/* 4. The Separator Line */}
              <div className="w-full h-px bg-[#1A1A1A] my-2"></div>

              {/* 5. The Action Buttons (Stacked natively at the bottom) */}
              <div className="w-full flex flex-col gap-3">
                <button type="button" onClick={() => setIsCleared(true)} disabled={isGenerating || isDispatching || isBooking} className="w-full py-3 text-sm text-white/50 hover:text-white transition-colors">Reject & Archive</button>
                <button type="button" onClick={handleRegenerate} disabled={isGenerating || isDispatching || isBooking} className="w-full py-3 text-sm font-bold bg-[#1A1A1A] text-white rounded-lg hover:bg-[#222]">
                  {isGenerating ? 'Drafting...' : 'Regenerate Draft'}
                </button>
                <button type="button" onClick={handleDispatch} disabled={isGenerating || isDispatching || isBooking} className="w-full py-3 text-sm font-bold bg-[#FF4F00] text-white rounded-lg hover:bg-[#ff6a00]">
                  {isDispatching ? 'Sending...' : 'Approve & Send'}
                </button>
                
                {isHotLead && (
                  <button type="button" onClick={() => setShowBookingModal(true)} disabled={isGenerating || isDispatching || isBooking} className="w-full py-3 text-sm font-bold border border-[#FF4F00] text-[#FF4F00] rounded-lg hover:bg-[#FF4F00]/10 flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    {isBooking ? 'Locking...' : 'Lock Meeting & Dispatch'}
                  </button>
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
    <EnterprisePaywall userTier={tier} featureName="Inbox Triage">
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

      {pageContent}
    </EnterprisePaywall>
  );
}