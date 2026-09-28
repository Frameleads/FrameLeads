import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORIES, QUESTIONS, REAL_CAPABILITIES, resetDiagnosticState, scoreDiagnostic } from '../src/lib/diagnostic/scoring';

const answer = (overrides: Record<string, string> = {}) => Object.fromEntries(
  QUESTIONS.map(question => [question.id, question.options[0].value]).concat(Object.entries(overrides)));

test('twelve bounded questions and exactly six scored dimensions', () => {
  assert.equal(QUESTIONS.length, 12);
  assert.equal(CATEGORIES.length, 6);
  assert.deepEqual(new Set(QUESTIONS.filter(q => q.category).map(q => q.category)), new Set(CATEGORIES));
});

test('scores are deterministic, bounded, and do not penalize reply volume', () => {
  const input = answer();
  const first = scoreDiagnostic(input);
  assert.deepEqual(first, scoreDiagnostic(input));
  assert.equal(first.maturity, scoreDiagnostic({ ...input, volume: 'over_500' }).maturity);
  assert.ok(first.maturity >= 0 && first.maturity <= 100);
  assert.equal(Object.keys(first.categoryScores).length, 6);
  for (const score of Object.values(first.categoryScores)) assert.ok(score >= 0 && score <= 100);
});

test('strong workflow has high maturity without invented gaps', () => {
  const result = scoreDiagnostic(answer());
  assert.equal(result.band, 'DECISION-READY');
  assert.deepEqual(result.gaps, []);
});

test('reported weaknesses produce bounded, answer-supported gaps tied to real capabilities', () => {
  const result = scoreDiagnostic(answer({ ai: 'ungoverned_auto', human: 'none', rules: 'none',
    priority: 'arrival_order', sla: 'none', history: 'rarely' }));
  assert.ok(result.gaps.length >= 3 && result.gaps.length <= 5);
  assert.equal(result.gaps[0].id, 'uncontrolled_ai');
  for (const gap of result.gaps) assert.ok((REAL_CAPABILITIES as readonly string[]).includes(gap.capability));
});

test('uncertain answers lower confidence and do not fabricate gaps', () => {
  const result = scoreDiagnostic(answer(Object.fromEntries(QUESTIONS.map(q => [q.id, 'not_sure']))));
  assert.equal(result.confidence, 0);
  assert.deepEqual(result.gaps, []);
});

test('missing or invalid answers are rejected', () => {
  assert.throws(() => scoreDiagnostic({}), /Answer required/);
  assert.throws(() => scoreDiagnostic(answer({ ai: 'invented' })), /Answer required: ai/);
});

test('CTA uses a real login route and reset clears local state', () => {
  const low = scoreDiagnostic(answer({ ownership: 'shared_unassigned', delay: 'next_day', triage: 'none',
    priority: 'arrival_order', history: 'rarely', rules: 'none', ai: 'ungoverned_auto',
    human: 'none', escalation: 'none', sla: 'none', revenue: 'none' }));
  assert.equal(low.band, 'FRAGMENTED');
  assert.equal(low.cta.href, '/login');
  assert.equal(scoreDiagnostic(answer()).cta.href, '/login');
  assert.deepEqual(resetDiagnosticState(), { answers: {}, result: null });
});

test('public page has no auth gate, AI request, database write, or persistence', () => {
  const middleware = readFileSync('src/middleware.ts', 'utf8');
  const page = readFileSync('src/app/diagnostic/page.tsx', 'utf8');
  const client = readFileSync('src/app/diagnostic/DiagnosticClient.tsx', 'utf8');
  assert.doesNotMatch(middleware.match(/matcher:\s*\[[^\]]*\]/)?.[0] ?? '', /diagnostic/);
  assert.doesNotMatch(page + client, /prisma|Gemini|fetch\(|localStorage|sessionStorage|cookies\(/i);
});
