'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Loader2, Info } from 'lucide-react';
import EnterpriseFeatureLocked from '@/components/EnterpriseFeatureLocked';

export default function TriageCommandCenter({ initialData }: { initialData: any }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [tier, setTier] = useState<string | null>(null);
  
  useEffect(() => {
    setTier(localStorage.getItem('userTier') || 'CORE');
  }, []);

  // If initialData is null, the queue is empty
  const [isCleared, setIsCleared] = useState(!initialData);

  // FINDING 1 FIX: Authoritative governance default string replaces contradictory autonomy text:
  const [draftText, setDraftText] = useState<any>(
    initialData?.aiDraft || "Michael, completely understand the hesitation—handing the keys to an unconstrained AI is exactly how agencies burn their primary domains. That is why we built the Velvet Rope Protocol. FrameLeads doesn't blindly send; it routes standard inquiries autonomously, but the moment it detects a high-value objection like yours, it pauses the automation and kicks the draft to your desk for human approval. Your domain reputation remains mathematically protected. Are you open to a 10-minute technical teardown this Thursday to see the governance engine in action?"
  );

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
          inboundSignal: initialData?.rawEmail || '',
          timestamp: Date.now(),
          force_regenerate: true
        }),
        cache: 'no-store'
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.reply && data.reply !== draftText) {
          setDraftText(data.reply);
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

  const handleApprove = async () => {
    setIsSending(true);
    try {
      const finalBody = typeof draftText === 'object' && draftText !== null
        ? (draftText as any).body || ''
        : String(draftText);

      const finalSubject = typeof draftText === 'object' && draftText !== null
        ? (draftText as any).subject || 'Re: Integration timeline'
        : 'Re: Integration timeline';

      const payload = {
        signalId: initialData?.id || 'demo_signal_michael_blazon',
        prospectName: initialData?.prospectName || 'Michael',
        prospectEmail: initialData?.prospectEmail || 'michael@blazonagency.com',
        subject: finalSubject,
        finalText: finalBody,
        status: 'APPROVED',
        timestamp: Date.now()
      };

      const res = await fetch('/api/triage/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setIsCleared(true);
      } else {
        const errData = await res.json().catch(() => null);
        console.warn("Backend approval response non-200, transitioning to cleared:", errData || res.statusText);
        setIsCleared(true);
      }
    } catch (err) {
      console.error("Network transmission error during approval:", err);
      setIsCleared(true);
    } finally {
      setIsSending(false);
    }
  };

  if (tier === null) return null; // Prevent hydration flicker

  // The "Inbox Zero" Success State
  // For CORE users behind the paywall, the triage content still renders
  // in the background so the blur has populated UI to display.
  if (isCleared && tier !== 'CORE') {
    return (
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
          onClick={() => { setIsCleared(false); setIsSending(false); }}
          className="mt-8 text-sm text-gray-500 hover:text-white transition-colors underline underline-offset-4"
        >
          Reset Demo State
        </button>
      </div>
    );
  }

  const pageContent = (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-200 p-8 font-sans">
      
      {/* Top Navigation / Status Bar */}
      <div className="flex flex-col md:flex-row md:justify-between items-start md:items-center mb-12 border-b border-gray-800 pb-6 gap-4 md:gap-0">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide" style={{ fontFamily: 'Oxanium, sans-serif' }}>
            EXECUTIVE OVERRIDE QUEUE
          </h1>
          <p className="text-gray-500 mt-1 text-sm">1 High-Priority Event Requires Judgment</p>
        </div>
        <div className="flex flex-row items-center gap-3 space-x-0 md:space-x-4 text-sm font-medium">
          <span className="px-3 py-1 bg-red-900/30 text-red-500 rounded border border-red-900/50 uppercase tracking-widest" style={{ fontFamily: 'Oxanium, sans-serif' }}>
            Risk: {initialData?.intentRisk || 'High'}
          </span>
          <span className="px-3 py-1 bg-gray-800 text-gray-300 rounded border border-gray-700 uppercase tracking-widest" style={{ fontFamily: 'Oxanium, sans-serif' }}>
            Signal: {initialData?.intentType || 'OBJECTION_SECURITY'}
          </span>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-12">
        
        {/* LEFT PANE: The Context Engine (40%) */}
        <div className="w-full lg:w-2/5 flex flex-col space-y-8">
          
          {/* Prospect Identity & Metrics */}
          <div className="bg-[#121212] border border-gray-800 p-8 rounded-lg shadow-2xl">
            <h2 className="text-xs text-gray-500 uppercase tracking-widest mb-4" style={{ fontFamily: 'Oxanium, sans-serif' }}>Entity Context</h2>
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white">{initialData?.prospectName || 'Michael'}</h3>
              <p className="text-gray-400">{initialData?.prospectContext || 'Blazon Agency'}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4 border-t border-gray-800 pt-6">
              <div>
                <p className="text-xs text-gray-500 uppercase">Pipeline Value</p>
                <p className="text-lg font-medium text-white mt-1">${initialData?.pipelineValue ? initialData.pipelineValue.toLocaleString() : '60,000'} ARR</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Deal Stage</p>
                <p className="text-lg font-medium text-white mt-1">{initialData?.dealStage || 'High-Intent Reply'}</p>
              </div>
            </div>
          </div>

          {/* Inbound Raw Message */}
          <div className="bg-[#121212] border border-gray-800 p-8 rounded-lg flex-grow">
            <h2 className="text-xs text-gray-500 uppercase tracking-widest mb-4" style={{ fontFamily: 'Oxanium, sans-serif' }}>Inbound Signal</h2>
            <div className="prose prose-invert max-w-none text-gray-300 text-sm leading-relaxed" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              <p className="text-gray-500 mb-4">Received: {initialData?.createdAt ? new Date(initialData.createdAt).toLocaleString() : 'Today, 8:14 AM'}</p>
              <div className="whitespace-pre-wrap">
                {initialData?.rawEmail || "Akram, the architecture looks solid, but my engineering team has concerns about handing over our primary domain reputation to an autonomous AI agent. How does FrameLeads prevent the AI from hallucinating a response and burning a high-ticket relationship? We need guarantees before moving forward."}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANE: The Cognitive Architecture (60%) */}
        <div className="w-full lg:w-3/5 flex flex-col">
          <div className="bg-[#121212] border border-gray-800 p-10 rounded-lg flex-grow flex flex-col relative">
            
            {/* Strategy Note */}
            <div className="bg-[#1a1a1a] border border-gray-800 p-4 rounded-md mb-8 transition-opacity duration-500">
              <h4 className="text-xs text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-2" style={{ fontFamily: 'Oxanium, sans-serif' }}>
                <span className={`w-2 h-2 rounded-full inline-block ${isGenerating ? 'bg-yellow-500 animate-pulse' : 'bg-orange-600'}`}></span>
                Claude Sonnet Strategy Logic
              </h4>
              <p className="text-sm text-gray-400 italic">
                {isGenerating 
                  ? "Re-evaluating context vectors. Generating structural reframe..." 
                  : "Intent classified as structural objection (Security/Hallucination fear). Addressed the domain reputation concern directly. Re-framed platform as governed infrastructure (Velvet Rope Protocol), emphasizing that AI never sends unsupervised on high-stakes deals. Positioned for a technical teardown call."}
              </p>
            </div>

            {/* AI Draft & Edit Toggle */}
            <div className="flex-grow flex flex-col mb-8 pb-20 relative">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xs text-gray-500 uppercase tracking-widest" style={{ fontFamily: 'Oxanium, sans-serif' }}>Draft Response</h2>
                
                {/* Brand Safety Toggle */}
                <button 
                  onClick={() => setIsEditing(!isEditing)}
                  disabled={isGenerating || isSending}
                  className={`text-xs px-4 py-1.5 rounded uppercase tracking-wider transition-colors disabled:opacity-50 ${isEditing ? 'bg-orange-600/20 text-orange-500 border border-orange-600/50' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}
                >
                  {isEditing ? 'Lock Draft' : 'Unlock Edit Mode'}
                </button>
              </div>

              {isEditing ? (
                <div className="flex flex-col flex-grow">
                  {typeof draftText === 'object' && draftText !== null && (draftText as any).subject && (
                    <div className="text-xs font-bold text-gray-400 mb-2">Subject: {(draftText as any).subject}</div>
                  )}
                  <textarea 
                    className="w-full flex-grow max-h-[300px] overflow-y-auto bg-[#0a0a0a] border border-orange-600/50 rounded p-6 text-gray-200 text-base leading-relaxed focus:outline-none focus:ring-1 focus:ring-orange-600 transition-all resize-none"
                    value={typeof draftText === 'object' && draftText !== null ? (draftText as any).body || '' : typeof draftText === 'string' ? draftText : String(draftText)}
                    onChange={(e) => {
                      if (typeof draftText === 'object' && draftText !== null) {
                        setDraftText({ ...draftText, body: e.target.value });
                      } else {
                        setDraftText(e.target.value);
                      }
                    }}
                    style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                  />
                </div>
              ) : (
                <div 
                  className={`w-full flex-grow max-h-[300px] overflow-y-auto bg-[#0a0a0a] border border-gray-800 rounded p-6 text-gray-200 text-base leading-relaxed whitespace-pre-wrap transition-opacity duration-300 ${isGenerating ? 'opacity-30' : 'opacity-100'}`}
                  style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                >
                  {typeof draftText === 'object' && draftText !== null ? (
                    <>
                      {(draftText as any).subject && (
                        <div className="text-xs font-bold text-gray-400 mb-2">Subject: {(draftText as any).subject}</div>
                      )}
                      {(draftText as any).body || ''}
                    </>
                  ) : typeof draftText === 'string' ? (
                    draftText
                  ) : (
                    String(draftText)
                  )}
                </div>
              )}

              {/* FINDING 2 UI NOTE: Clinical footer reminding CEOs they own the CTA preference */}
              <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 italic" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-orange-600/80 inline-block"></span>
                CTA defaults to your Campaign Context preference. Edit this draft anytime before approving.
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-col md:flex-row justify-between items-center pt-6 border-t border-gray-800 gap-3 md:gap-0 w-full absolute bottom-0 left-0 right-0 px-10 pb-10 bg-[#121212]">
              <button 
                onClick={() => setIsCleared(true)} 
                disabled={isGenerating || isSending} 
                className="w-full md:w-auto text-gray-500 hover:text-red-400 text-sm font-medium transition-colors disabled:opacity-50 pb-2 md:pb-0"
              >
                Reject {"&"} Archive
              </button>
              
              <div className="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto">
                <button 
                  onClick={handleRegenerate}
                  disabled={isGenerating || isSending}
                  className="w-full md:w-auto px-6 py-3 bg-transparent border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 rounded font-medium text-sm whitespace-nowrap transition-all disabled:opacity-50"
                >
                  {isGenerating ? 'Drafting...' : 'Regenerate Draft'}
                </button>
                <button 
                  onClick={handleApprove}
                  disabled={isGenerating || isSending}
                  className="w-full md:w-auto px-6 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded font-medium text-sm whitespace-nowrap shadow-[0_0_15px_rgba(234,88,12,0.2)] transition-all disabled:opacity-50 flex justify-center items-center"
                >
                  {isSending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  {isSending ? 'Sending...' : 'Approve & Send'}
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );

  if (tier === 'CORE') {
    return (
      <>
        {/* 1. The Actual Real UI rendered in background, but frozen */}
        <div className="pointer-events-none select-none opacity-40 overflow-hidden h-[80vh]">
          {pageContent}
        </div>
        
        {/* 2. Full-Screen Fixed Overlay (Sidebar is z-50, this is z-40, so Sidebar stays clear) */}
        <div className="fixed inset-0 z-40 backdrop-blur-md bg-black/40 flex items-center justify-center md:pl-[288px]">
          <EnterpriseFeatureLocked
            featureName="Inbox Triage"
            description="Autonomous objection handling and signal-triggered draft generation are exclusively available on the Enterprise Tier."
          />
        </div>
      </>
    );
  }

  return pageContent;
}