'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CATEGORIES, QUESTIONS, resetDiagnosticState, scoreDiagnostic, type DiagnosticResult } from '@/lib/diagnostic/scoring';

const panel = 'rounded-xl border border-[#292929] bg-[#111111] p-4 sm:p-6';
export default function DiagnosticClient() {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const answered = QUESTIONS.filter(question => answers[question.id]).length;
  function restart() {
    const empty = resetDiagnosticState();
    setAnswers(empty.answers); setResult(empty.result);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  return <main className="min-h-screen bg-black px-4 py-8 text-white sm:px-8 sm:py-12">
    <div className="mx-auto max-w-3xl space-y-7">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[.24em] text-[#FF5A1F]">FrameLeads · Reply Operations</p>
        <h1 className="text-3xl font-semibold sm:text-4xl">Diagnose My Reply Workflow</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-gray-400">See where your reply process is strong and where important decisions may lack structure. Your answers stay in this browser session; no email or sign-in is required to see the result.</p>
      </header>
      {!result ? <form className="space-y-4" onSubmit={event => {
        event.preventDefault();
        if (answered !== QUESTIONS.length) return;
        setResult(scoreDiagnostic(answers)); window.scrollTo({ top: 0, behavior: 'smooth' });
      }}>
        <div className="flex items-center justify-between text-xs text-gray-400" role="status">
          <span>{answered} of {QUESTIONS.length} answered</span><span>No account required</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#242424]" aria-hidden="true">
          <div className="h-full bg-[#FF5A1F] transition-[width]" style={{ width: `${answered / QUESTIONS.length * 100}%` }} /></div>
        {QUESTIONS.map((question, index) => <fieldset key={question.id} className={panel}>
          <legend className="mb-3 w-full text-sm font-medium leading-relaxed sm:text-base">
            <span className="mr-2 font-mono text-[#FF5A1F]">{String(index + 1).padStart(2, '0')}</span>{question.label}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">{question.options.map(choice => <label key={choice.value}
            className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-[#FF5A1F] ${answers[question.id] === choice.value ? 'border-[#FF5A1F] bg-[#FF5A1F]/10 text-white' : 'border-[#333] bg-black/40 text-gray-300 hover:border-[#777]'}`}>
            <input type="radio" name={question.id} value={choice.value} checked={answers[question.id] === choice.value}
              onChange={() => setAnswers(current => ({ ...current, [question.id]: choice.value }))}
              className="h-4 w-4 shrink-0 accent-[#FF5A1F]" required />
            <span>{choice.label}</span></label>)}</div>
        </fieldset>)}
        <button type="submit" disabled={answered !== QUESTIONS.length}
          className="w-full rounded-lg bg-[#FF5A1F] px-5 py-3 font-semibold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40">
          See my diagnosis</button>
      </form> : <section className="space-y-5" aria-label="Diagnostic result">
        <div className={panel}><p className="text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Reply Decision Maturity</p>
          <p className="mt-2 text-4xl font-semibold">{result.maturity}<span className="text-lg text-gray-500"> / 100</span></p>
          <p className="mt-2 text-sm text-gray-300">{result.band.replaceAll('-', ' ')} · Answer confidence {result.confidence}%</p>
          <p className="mt-3 text-xs text-gray-500">A diagnostic maturity index based only on your answers. It is not a revenue estimate, benchmark percentile, or success probability.</p>
          {result.confidence < 70 && <p className="mt-2 text-xs text-amber-300">Several answers were uncertain; treat this result as directional.</p>}</div>
        <div className={panel}><h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Six operating dimensions</h2>
          <div className="grid gap-3 sm:grid-cols-2">{CATEGORIES.map(category => <div key={category} className="rounded-lg border border-[#292929] bg-black/40 p-3">
            <div className="flex items-center justify-between gap-3 text-sm"><span>{category}</span><strong>{result.categoryScores[category]} / 100</strong></div>
            <div className="mt-2 h-1.5 rounded-full bg-[#242424]" aria-hidden="true"><div className="h-full rounded-full bg-[#FF5A1F]" style={{ width: `${result.categoryScores[category]}%` }} /></div>
          </div>)}</div></div>
        <div className={panel}><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">Priority gaps and prescription</h2>
          {result.gaps.length ? <ol className="space-y-4">{result.gaps.map((gap, index) => <li key={gap.id} className="border-t border-[#292929] pt-3">
            <p className="font-medium"><span className="mr-2 text-[#FF5A1F]">{index + 1}.</span>{gap.title}</p>
            <p className="mt-1 text-sm text-gray-400">{gap.why}</p>
            <p className="mt-2 text-xs text-gray-300">Relevant FrameLeads capability: <span className="text-[#FF5A1F]">{gap.capability}</span></p>
          </li>)}</ol> : <p className="text-sm text-gray-300">No material gap was identified from these answers. Your reported workflow appears structured across the six dimensions.</p>}</div>
        <div className={`${panel} space-y-3`}><h2 className="text-xs font-semibold uppercase tracking-widest text-[#FF5A1F]">One next step</h2>
          <p className="text-sm text-gray-400">Explore how FrameLeads supports the diagnosed workflow.</p>
          <Link href={result.cta.href} className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#FF5A1F] px-5 py-3 font-semibold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            {result.cta.label}</Link></div>
        <button type="button" onClick={restart} className="text-sm text-gray-400 underline underline-offset-4 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF5A1F]">Restart diagnostic</button>
      </section>}
    </div>
  </main>;
}
