'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

export default function TriageCommandCenter({ initialData, userTier }: { initialData: any, userTier: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  
  // If initialData is null, the queue is empty
  const [isCleared, setIsCleared] = useState(!initialData);

  const [draftText, setDraftText] = useState(
    initialData?.aiDraft || "Placeholder Claude Sonnet response... AI architecture connecting."
  );

  const handleRegenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inboundSignal: initialData?.rawEmail || '',
          timestamp: Date.now()
        }),
        cache: 'no-store'
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.reply) {
          setDraftText(data.reply);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApprove = async () => {
    setIsSending(true);
    try {
      const res = await fetch('/api/triage/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signalId: initialData?.id,
          finalText: draftText
        })
      });
      if (res.ok) {
        setIsCleared(true);
      } else {
        setIsSending(false);
      }
    } catch (err) {
      console.error(err);
      setIsSending(false);
    }
  };

  // The "Inbox Zero" Success State
  if (isCleared) {
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

  // The "CORE" Tier Lock Screen
  if (userTier === 'CORE') {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-center p-8 relative overflow-hidden">
        {/* Blurred background representation */}
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none filter blur-xl">
           <div className="bg-[#121212] w-full h-full border border-gray-800 p-8 rounded-lg shadow-2xl"></div>
        </div>
        <div className="relative z-10 w-20 h-20 border border-gray-800 rounded-full flex items-center justify-center mb-6 bg-[#121212]">
          <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="relative z-10 text-2xl font-bold text-white tracking-wide mb-3" style={{ fontFamily: 'Oxanium, sans-serif' }}>
          RESTRICTED ACCESS
        </h2>
        <p className="relative z-10 text-gray-500 max-w-md mb-8 leading-relaxed" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Inbox Triage is restricted to Enterprise Infrastructure. Upgrade to unlock autonomous objection handling.
        </p>
        <button 
          onClick={() => {}}
          className="relative z-10 h-12 px-8 rounded-xl bg-primary text-primary-foreground text-base font-medium transition-all hover:opacity-90 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98]"
        >
          Upgrade Infrastructure
        </button>
      </div>
    );
  }

  return (
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
            Type: {initialData?.intentType || 'Objection'}
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
              <h3 className="text-xl font-semibold text-white">{initialData?.prospectName || 'Marcus Vance'}</h3>
              <p className="text-gray-400">{initialData?.prospectContext || 'Chief Operations Officer @ Nexus Systems'}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4 border-t border-gray-800 pt-6">
              <div>
                <p className="text-xs text-gray-500 uppercase">Pipeline Value</p>
                <p className="text-lg font-medium text-white mt-1">${initialData?.pipelineValue ? initialData.pipelineValue.toLocaleString() : '45,000'} ARR</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Deal Stage</p>
                <p className="text-lg font-medium text-white mt-1">{initialData?.dealStage || 'Technical Review'}</p>
              </div>
            </div>
          </div>

          {/* Inbound Raw Message */}
          <div className="bg-[#121212] border border-gray-800 p-8 rounded-lg flex-grow">
            <h2 className="text-xs text-gray-500 uppercase tracking-widest mb-4" style={{ fontFamily: 'Oxanium, sans-serif' }}>Inbound Signal</h2>
            <div className="prose prose-invert max-w-none text-gray-300 text-sm leading-relaxed" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              <p className="text-gray-500 mb-4">Received: {initialData?.createdAt ? new Date(initialData.createdAt).toLocaleString() : 'Today, 8:14 AM'}</p>
              <div className="whitespace-pre-wrap">
                {initialData?.rawEmail || "Akram,\n\nThe team reviewed the proposal. The functionality looks solid, but I'm highly concerned about the integration timeline.\n\nWe got burned on our last Zapier-heavy automation stack and I can't afford another quarter of our SDRs manually fixing routing errors. Why should I trust this deployment will be any different?\n\n- Marcus"}
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
                  : "Intent classified as structural objection (integration fear). Addressed the Zapier trauma directly. Re-framed our platform as native schema mapping, not routing, to immediately re-establish technical authority."}
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
}