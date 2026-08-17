'use client';

import { useState, useRef, useEffect } from 'react';

interface Props {
  value: string;       // "YYYY-MM-DDTHH:MM" (datetime-local format)
  onChange: (v: string) => void;
  label: string;
  synced?: boolean;    // drives the AI SYS-SYNC pulse indicator
}

// Offer all 24 hours and minutes in 5-min steps for clean UX
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

export default function TelemetryDatePicker({ value, onChange, label, synced = false }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hourRef = useRef<HTMLDivElement>(null);
  const minuteRef = useRef<HTMLDivElement>(null);

  // ── Parse stored value ──────────────────────────────────────────────────
  const parsed = value ? new Date(value) : null;
  const isValid = parsed !== null && !isNaN(parsed.getTime());

  const displayDate = isValid
    ? `${parsed!.getFullYear()}.${String(parsed!.getMonth() + 1).padStart(2, '0')}.${String(parsed!.getDate()).padStart(2, '0')}`
    : '----.--.--.';
  const hourVal = isValid ? parsed!.getHours() : -1;
  const minVal  = isValid ? parsed!.getMinutes() : -1;
  const displayTime = isValid
    ? `${String(hourVal).padStart(2, '0')}:${String(minVal).padStart(2, '0')}`
    : '--:--';

  // ── Close on outside click ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Scroll active item into view when dropdown opens ───────────────────
  useEffect(() => {
    if (!open) return;
    const scrollTo = (ref: React.RefObject<HTMLDivElement | null>, idx: number, itemHeight = 32) => {
      if (ref.current && idx >= 0) {
        ref.current.scrollTop = Math.max(0, idx * itemHeight - itemHeight * 2);
      }
    };
    setTimeout(() => {
      scrollTo(hourRef, hourVal);
      scrollTo(minuteRef, minVal / 5);
    }, 20);
  }, [open, hourVal, minVal]);

  // ── Emit updated value ──────────────────────────────────────────────────
  const setTime = (h: number, m: number) => {
    // If no date has been set yet, default to today
    const datePart = value && isValid
      ? value.slice(0, 10)
      : (() => {
          const t = new Date();
          return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        })();
    onChange(`${datePart}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };

  return (
    <div ref={containerRef} className="relative">

      {/* Label + AI SYS-SYNC indicator */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-gray-500 uppercase tracking-widest" style={{ fontFamily: 'Oxanium, sans-serif' }}>
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${synced ? 'bg-green-500 animate-pulse' : 'bg-gray-700'}`} />
          <span className="text-[10px] text-gray-600 uppercase tracking-widest" style={{ fontFamily: 'Oxanium, sans-serif' }}>
            AI SYS-SYNC
          </span>
        </div>
      </div>

      {/* Data Pill */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full bg-[#1A1A1A] border border-[#333] text-[#FF5A1F] font-mono text-sm px-4 py-3 rounded-md flex items-center justify-between cursor-pointer hover:border-[#FF5A1F]/50 transition-all"
      >
        <span className={isValid ? 'text-[#FF5A1F]' : 'text-gray-700'}>
          {isValid ? `[ ${displayDate} // ${displayTime} ]` : '[ NO SLOT LOCKED ]'}
        </span>
        <svg
          className={`w-3 h-3 text-gray-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Custom Time Scroller Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 mt-1.5 z-50 bg-[#000000] border border-[#333] rounded-lg shadow-2xl shadow-black/80 overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1a1a1a]">
            <span className="text-[9px] text-gray-600 uppercase tracking-widest font-medium" style={{ fontFamily: 'Oxanium, sans-serif' }}>
              Set Time
            </span>
            <span className="text-[9px] text-[#FF5A1F]/60 font-mono tracking-widest">
              {displayDate}
            </span>
          </div>

          <div className="flex" style={{ height: '192px' }}>

            {/* Hours Column */}
            <div ref={hourRef} className="flex-1 overflow-y-auto border-r border-[#111] scrollbar-none">
              <div className="sticky top-0 bg-[#000] py-1 text-[9px] text-gray-700 uppercase text-center tracking-widest border-b border-[#111]">HH</div>
              {HOURS.map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setTime(h, minVal >= 0 ? minVal : 0)}
                  className={`w-full text-center py-2 text-xs font-mono transition-colors ${
                    h === hourVal
                      ? 'bg-[#FF5A1F] text-white'
                      : 'text-gray-500 hover:bg-[#FF5A1F]/10 hover:text-[#FF5A1F]'
                  }`}
                >
                  {String(h).padStart(2, '0')}
                </button>
              ))}
            </div>

            {/* Separator */}
            <div className="flex items-center justify-center w-6 bg-[#000] text-gray-700 text-sm font-mono select-none">:</div>

            {/* Minutes Column */}
            <div ref={minuteRef} className="flex-1 overflow-y-auto border-l border-[#111] scrollbar-none">
              <div className="sticky top-0 bg-[#000] py-1 text-[9px] text-gray-700 uppercase text-center tracking-widest border-b border-[#111]">MM</div>
              {MINUTES.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setTime(hourVal >= 0 ? hourVal : 9, m);
                    setOpen(false);
                  }}
                  className={`w-full text-center py-2 text-xs font-mono transition-colors ${
                    m === minVal
                      ? 'bg-[#FF5A1F] text-white'
                      : 'text-gray-500 hover:bg-[#FF5A1F]/10 hover:text-[#FF5A1F]'
                  }`}
                >
                  {String(m).padStart(2, '0')}
                </button>
              ))}
            </div>

          </div>

          {/* Footer: current selection display */}
          <div className="px-4 py-2.5 border-t border-[#1a1a1a] flex items-center justify-between">
            <span className="text-[10px] text-gray-700 font-mono">
              {isValid ? `[ ${displayDate} // ${displayTime} ]` : '[ SELECT A TIME ]'}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[10px] text-[#FF5A1F]/60 hover:text-[#FF5A1F] uppercase tracking-widest transition-colors"
              style={{ fontFamily: 'Oxanium, sans-serif' }}
            >
              LOCK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
