import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decisionStatusPresentation } from '../src/lib/decision/status-presentation';
import { formatIntentTemperature, intentTemperature, isHighPriorityIntent, resolveIntentTemperature } from '../src/lib/intent-temperature';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('Inbox Triage maps canonical decision statuses to semantic tones', () => {
  assert.match(decisionStatusPresentation('READY').tone, /text-emerald-300/);
  assert.match(decisionStatusPresentation('NEEDS_REVIEW').tone, /text-amber-300/);
  assert.match(decisionStatusPresentation('FAILED').tone, /text-red-300/);
  assert.match(decisionStatusPresentation('PENDING').tone, /text-white\/45/);
  assert.match(decisionStatusPresentation('UNRECOGNIZED').tone, /text-white\/45/);
});

test('prospect interest thresholds and rendered temperature labels are centralized and unresolved stays unassessed', () => {
  assert.equal(intentTemperature(59), 'COLD');
  assert.equal(intentTemperature(52), 'COLD');
  assert.equal(intentTemperature(60), 'WARM');
  assert.equal(intentTemperature(79), 'WARM');
  assert.equal(intentTemperature(80), 'HOT');
  assert.equal(intentTemperature(null), null);
  assert.equal(intentTemperature(Number.NaN), null);
  assert.equal(isHighPriorityIntent(80), true);
  assert.equal(isHighPriorityIntent(79), false);
  assert.equal(isHighPriorityIntent(null), false);
  assert.equal(resolveIntentTemperature(null, 'WARM'), 'WARM');
  assert.equal(resolveIntentTemperature(101, 'HOT'), null);
  assert.equal(formatIntentTemperature(80), '🔥 HOT');
  assert.equal(formatIntentTemperature(60), '☀️ WARM');
  assert.equal(formatIntentTemperature(52), '❄️ COLD');
  assert.equal(formatIntentTemperature(null), 'UNASSESSED');
});

test('UI polling loads a decision after an initially empty GET without starting another analysis', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(panel, /packet\?\.status !== 'PENDING' && !awaitingDecision/);
  assert.match(panel, /fetch\(`\/api\/decisions\?signalId=/);
  assert.match(panel, /if \(!packet && Date\.now\(\) - autoWaitStartedAt\.current >= 60_000\)/);
  assert.doesNotMatch(panel.slice(panel.indexOf('useEffect(() => {\n    if (packet?.status'), panel.indexOf('useEffect(() => {\n    if (!isEnterpriseTier')), /decisions\/triage/);
});

test('Replay link resolves to the authenticated historical product read model', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const page = source('src/app/dashboard/decisions/[decisionId]/replay/page.tsx');
  const route = source('src/app/api/decisions/[decisionId]/replay/route.ts');
  const service = source('src/lib/decision/replay.ts');
  assert.match(panel, /href=\{`\/dashboard\/decisions\/\$\{encodeURIComponent\(packet\.id\)\}\/replay`\}/);
  assert.match(page, /await getDecisionReplay\(\{ userId: user\.id, decisionId \}\)/);
  assert.match(route, /getDecisionReplay\(\{ userId, decisionId \}\)/);
  assert.match(service, /Historical read model only/);
  assert.match(service, /findFirst\(\{ where: \{ id: input\.decisionId, userId: input\.userId \}/);
});

test('Re-analyze uses the canonical decision endpoint and creates a retry version', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const route = source('src/app/api/decisions/triage/route.ts');
  const service = source('src/lib/decision/triage.ts');
  assert.match(panel, /fetch\('\/api\/decisions\/triage'/);
  assert.match(panel, /retryOfDecisionId: retry \? packet\?\.id : undefined/);
  assert.match(route, /triageInboundSignal\(\{ userId, signalId: body\.signalId\.trim\(\),\s*retryOfDecisionId: body\.retryOfDecisionId \|\| undefined \}\)/);
  assert.match(service, /if \(input\.retryOfDecisionId\)/);
  assert.match(service, /db\.decision\.update\(\{ where: \{ id: pending\.id/);
  assert.match(panel, /disabled=\{running \|\| loading \|\| packet\?\.status === 'PENDING'\}/);
  assert.match(panel, /setError\('Decision analysis failed/);
});

test('Mobile and desktop layouts keep queues, packet, chips, details, and actions responsive', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(panel, /grid[^"\n]*grid-cols-1[^"\n]*sm:grid-cols-2[^"\n]*xl:grid-cols-\[1\.5fr_1fr_1fr_1\.1fr\]/);
  assert.match(panel, /overflow-x-auto flex-nowrap/);
  assert.match(panel, /w-\[82vw\].*max-w-\[300px\].*sm:w-\[300px\]/);
  assert.match(panel, /min-h-\[18rem\]/);
  assert.match(panel, /xl:whitespace-nowrap/);
  assert.match(panel, /sm:grid-cols-2 xl:grid-cols-3/);
  assert.match(panel, /flex flex-wrap gap-2/);
  assert.match(panel, /flex flex-col gap-3.*sm:flex-row/);
  assert.match(panel, /flex flex-1 flex-col gap-6 xl:flex-row/);
  assert.match(panel, /min-h-11/);
  assert.match(panel, /prefers-reduced-motion: reduce/);
  assert.match(panel, /animation: none/);
});

test('lower controls stay wired to their real handlers without invoking them in QA', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(panel, /onClick=\{\(\) => setIsEditing\(!isEditing\)\}/);
  assert.match(panel, /onClick=\{handleRegenerate\}/);
  assert.match(panel, /onClick=\{\(\) => void handleDispatch\(\)\}/);
  assert.match(panel, /onClick=\{\(\) => setShowBookingModal\(true\)\}/);
  assert.match(panel, /onClick=\{handleArchive\}/);
  assert.match(panel, /onClick=\{handlePermanentDelete\}/);
});
