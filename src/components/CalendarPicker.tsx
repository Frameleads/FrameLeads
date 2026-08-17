'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// ── Types & Constants ─────────────────────────────────────────────────────
interface Props {
  value: string | null; // Strict ISO 8601 e.g. "2026-08-21T14:00:00"
  onChange: (iso: string) => void;
  label: string;
  synced?: boolean;     // Controls AI SYS-SYNC pulse indicator
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// 12-Hour format slots (12, 1-11)
const TIME_SLOTS_12H: { h: number; m: number }[] = [];
for (let h of [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
  for (let m = 0; m < 60; m += 20) {
    TIME_SLOTS_12H.push({ h, m });
  }
}

// ── Utility Helpers ────────────────────────────────────────────────────────

/** Days in a given month */
function daysInMonth(y: number, mo: number) {
  return new Date(y, mo + 1, 0).getDate();
}

/** First column offset for the month grid (Mo = 0, Su = 6) */
function startOffset(y: number, mo: number) {
  return (new Date(y, mo, 1).getDay() + 6) % 7;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function isPast(y: number, mo: number, d: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(y, mo, d) < today;
}

/** Emit a clean local ISO string — no UTC conversion, preserves local intent */
function toISO(y: number, mo: number, d: number, h: number, m: number): string {
  const date = new Date(y, mo, d, h, m);
  return date.toISOString();
}

// ── Component ──────────────────────────────────────────────────────────────

export default function CalendarPicker({ value, onChange, label, synced = false }: Props) {
  const today = new Date();
  const parsed = value ? new Date(value) : null;
  const valid = parsed !== null && !isNaN(parsed.getTime());

  // View state (what month is displayed)
  const [viewYear,  setViewYear]  = useState(valid ? parsed!.getFullYear()  : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(valid ? parsed!.getMonth()     : today.getMonth());

  // Selection state (decoupled from the displayed ISO)
  const [selYear,  setSelYear]  = useState<number | null>(valid ? parsed!.getFullYear()  : null);
  const [selMonth, setSelMonth] = useState<number | null>(valid ? parsed!.getMonth()     : null);
  const [selDay,   setSelDay]   = useState<number | null>(valid ? parsed!.getDate()      : null);
  const [selHour,  setSelHour]  = useState<number | null>(valid ? parsed!.getHours()     : null);
  const [selMin,   setSelMin]   = useState<number | null>(valid ? parsed!.getMinutes()   : null);

  // Local meridiem state
  const [meridiem, setMeridiem] = useState<'AM'|'PM'>(
    valid ? (parsed!.getHours() >= 12 ? 'PM' : 'AM') : 'AM'
  );

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Re-sync when parent pushes a new ISO value (e.g. Quick Fill pills)
  useEffect(() => {
    if (!value) return;
    const d = new Date(value);
    if (isNaN(d.getTime())) return;
    setSelYear(d.getFullYear());
    setSelMonth(d.getMonth());
    setSelDay(d.getDate());
    setSelHour(d.getHours());
    setSelMin(d.getMinutes());
    setMeridiem(d.getHours() >= 12 ? 'PM' : 'AM');
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }, [value]);

  // ── Derived display ──────────────────────────────────────────────────────
  const hasDate = selYear !== null && selMonth !== null && selDay !== null;
  const hasTime = selHour !== null && selMin !== null;

  const pillDateStr = hasDate
    ? `${selYear}.${String(selMonth! + 1).padStart(2, '0')}.${String(selDay!).padStart(2, '0')}`
    : '----.--.--.';
  const pillTimeStr = hasTime
    ? `${String(selHour!).padStart(2, '0')}:${String(selMin!).padStart(2, '0')}`
    : '--:--';
  const pillText = hasDate || hasTime
    ? `[ ${pillDateStr} // ${pillTimeStr} ]`
    : '[ NO SLOT LOCKED ]';

  // ── Event handlers ───────────────────────────────────────────────────────
  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(v => v - 1); }
    else setViewMonth(v => v - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(v => v + 1); }
    else setViewMonth(v => v + 1);
  };

  const handleDayClick = (day: number) => {
    if (isPast(viewYear, viewMonth, day)) return;
    setSelYear(viewYear);
    setSelMonth(viewMonth);
    setSelDay(day);
    // If time already chosen, emit immediately
    if (selHour !== null && selMin !== null) {
      onChange(toISO(viewYear, viewMonth, day, selHour, selMin));
    }
  };

  const handleTimeClick = (baseH: number, m: number) => {
    let actualH = baseH;
    if (meridiem === 'PM' && baseH !== 12) actualH += 12;
    if (meridiem === 'AM' && baseH === 12) actualH = 0;

    setSelHour(actualH);
    setSelMin(m);
    const y   = selYear  ?? viewYear;
    const mo  = selMonth ?? viewMonth;
    const d   = selDay   ?? today.getDate();
    onChange(toISO(y, mo, d, actualH, m));
    setOpen(false);
  };

  // ── Calendar grid cells ──────────────────────────────────────────────────
  const offset = startOffset(viewYear, viewMonth);
  const total  = daysInMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative">

      {/* Label + AI SYS-SYNC */}
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] text-[#F5F1E8] opacity-100 font-medium uppercase tracking-widest"
          style={{ fontFamily: 'Oxanium, sans-serif' }}
        >
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full transition-colors ${synced ? 'bg-green-500 animate-pulse' : 'bg-gray-700'}`} />
          <span className="text-[10px] text-[#F5F1E8] opacity-100 font-medium uppercase tracking-widest" style={{ fontFamily: 'Oxanium, sans-serif' }}>
            AI SYS-SYNC
          </span>
        </div>
      </div>

      {/* Data Pill Trigger */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full bg-[#1A1A1A] border border-[#333] font-mono text-sm px-4 py-3 rounded-md flex items-center justify-between cursor-pointer hover:border-[#FF5A1F]/50 transition-all"
      >
        <span className={(hasDate || hasTime) ? 'text-[#FF5A1F]' : 'text-gray-700'}>
          {pillText}
        </span>
        <ChevronRight
          className={`w-3 h-3 text-gray-600 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {/* ── Calendar Panel ─────────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95 w-full h-full p-4 overflow-y-auto">
          {/* 1. Full Screen Overlay (Stays the same) */}
          
          {/* 2. The Main Modal Card (Mobile: max-w-sm, Desktop: expands to max-w-4xl & goes side-by-side) */}
          <div className="w-full max-w-sm md:max-w-4xl mx-auto flex flex-col md:flex-row gap-6 md:gap-10 bg-[#0a0a0a] border border-[#1A1A1A] rounded-xl p-4 md:p-8 relative">
            
            {/* 3. Left Column: The Calendar (Mobile: Top, Desktop: Left half) */}
            <div className="w-full md:w-1/2 flex justify-center items-start">
              <div className="w-full scale-95 sm:scale-100 origin-top">
              {/* Month header */}
              <div className="flex items-center justify-between pb-3 mb-2 border-b border-[#1A1A1A]">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="p-1 text-[#F5F1E8] hover:text-white transition-colors rounded"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span
                  className="text-sm font-semibold text-[#F5F1E8] tracking-wide"
                  style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                >
                  {MONTH_NAMES[viewMonth]} {viewYear}
                </span>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="p-1 text-[#F5F1E8] hover:text-white transition-colors rounded"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Calendar grid */}
              <div className="pt-2 w-full">
                {/* Day-of-week header row */}
                <div className="grid grid-cols-7 mb-2 w-full">
                  {DAY_HEADERS.map(d => (
                    <div
                      key={d}
                      className="text-center text-[10px] text-[#F5F1E8] uppercase tracking-widest py-1 font-medium"
                      style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                    >
                      {d}
                    </div>
                  ))}
                </div>

                {/* Day cells */}
                <div className="grid grid-cols-7 gap-y-1 w-full">
                  {cells.map((day, idx) => {
                    if (day === null) return <div key={`e-${idx}`} />;
                    const past = isPast(viewYear, viewMonth, day);
                    const todayCell = sameDay(new Date(viewYear, viewMonth, day), today);
                    const selected = selYear === viewYear && selMonth === viewMonth && selDay === day;
                    return (
                      <button
                        key={`d-${idx}`}
                        type="button"
                        disabled={past}
                        onClick={() => handleDayClick(day)}
                        className={[
                          'relative mx-auto w-8 h-8 rounded-full flex items-center justify-center text-xs transition-all',
                          selected
                            ? 'bg-[#FF5A1F] text-white shadow-[0_0_12px_rgba(255,90,31,0.5)] font-bold'
                            : past
                              ? 'text-gray-800 cursor-not-allowed'
                              : 'text-[#F5F1E8] hover:bg-[#1A1A1A] cursor-pointer hover:text-white font-medium',
                        ].join(' ')}
                        style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                      >
                        {day}
                        {/* Today dot indicator */}
                        {todayCell && !selected && (
                          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#FF5A1F]/50" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            </div>

            {/* 4. Right Column: The Time Picker (Mobile: Bottom, Desktop: Right half with a divider line) */}
            <div className="w-full md:w-1/2 flex flex-col md:border-l md:border-[#1A1A1A] md:pl-10">
              <div className="w-full bg-[#0a0a0a] border border-[#1A1A1A] rounded-xl p-4 mt-2 flex flex-col max-h-[380px]">
                
                {/* AM/PM Toggle (Perfect 50/50 Split) */}
                <div className="flex w-full gap-4 border-b border-[#1A1A1A] pb-4 mb-4">
                  <button type="button" onClick={() => {
                      if (selHour !== null && selHour >= 12) setSelHour(selHour - 12);
                      else if (selHour === null) setSelHour(0);
                    }} className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${selHour === null || selHour < 12 ? 'bg-[#FF4F00] text-white shadow-sm' : 'bg-[#111] text-white/50 hover:text-white hover:bg-[#1A1A1A]'}`}>AM</button>
                  <button type="button" onClick={() => {
                      if (selHour !== null && selHour < 12) setSelHour(selHour + 12);
                      else if (selHour === null) setSelHour(12);
                    }} className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${selHour !== null && selHour >= 12 ? 'bg-[#FF4F00] text-white shadow-sm' : 'bg-[#111] text-white/50 hover:text-white hover:bg-[#1A1A1A]'}`}>PM</button>
                </div>
                
                {/* Split Grid (Perfect 50/50 Grid Alignment) */}
                <div className="grid grid-cols-2 gap-4 w-full h-[240px]">
                  
                  {/* 1-12 Hours */}
                  <div className="overflow-y-auto hide-scrollbar flex flex-col gap-2 pr-2 border-r border-[#1A1A1A] relative">
                    <div className="text-[10px] text-white/40 text-center font-bold pb-2 tracking-widest sticky top-0 bg-[#0a0a0a] z-10 uppercase">HR</div>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => {
                      const isPM = selHour !== null && selHour >= 12;
                      const actualH = isPM ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
                      const isActive = actualH === selHour;
                      return (
                      <button key={`hr-${h}`} type="button" onClick={() => handleTimeClick(actualH, selMin ?? 0)} className={`w-full py-3 text-base font-medium text-center text-white rounded-lg transition-colors ${isActive ? 'bg-[#FF4F00]' : 'bg-[#0D0D0D] hover:bg-[#1A1A1A]'}`}>{h}</button>
                    )})}
                  </div>
                  
                  {/* 00-50 Minutes */}
                  <div className="overflow-y-auto hide-scrollbar flex flex-col gap-2 pl-2 relative">
                    <div className="text-[10px] text-white/40 text-center font-bold pb-2 tracking-widest sticky top-0 bg-[#0a0a0a] z-10 uppercase">MIN</div>
                    {['00', '10', '20', '30', '40', '50'].map(m => {
                      const mNum = parseInt(m, 10);
                      const isActive = mNum === selMin;
                      return (
                      <button key={`min-${m}`} type="button" onClick={() => handleTimeClick(selHour ?? 0, mNum)} className={`w-full py-3 text-base font-medium text-center text-white rounded-lg transition-colors ${isActive ? 'bg-[#FF4F00]' : 'bg-[#0D0D0D] hover:bg-[#1A1A1A]'}`}>{m}</button>
                    )})}
                  </div>

                </div>
              </div>
              {/* Lock Button Footer (Push to bottom on desktop) */}
              <div className="w-full mt-auto pt-6 border-t border-[#1A1A1A] flex justify-between items-center">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {hasDate && hasTime
                    ? `ISO → ${toISO(selYear!, selMonth!, selDay!, selHour!, selMin!)}`
                    : 'Pick a date then a time'}
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-xs font-bold text-[#FF4F00] uppercase tracking-widest flex items-center gap-1"
                >
                  Lock <div className="w-2 h-2 bg-[#FF4F00] rounded-sm"></div>
                </button>
              </div>

            </div>

          </div>
        </div>
      )}
    </div>
  );
}
