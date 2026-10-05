import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decisionStatusPresentation } from '../src/lib/decision/status-presentation';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('Inbox Triage maps canonical decision statuses to semantic tones', () => {
  assert.match(decisionStatusPresentation('READY').tone, /text-emerald-300/);
  assert.match(decisionStatusPresentation('NEEDS_REVIEW').tone, /text-amber-300/);
  assert.match(decisionStatusPresentation('FAILED').tone, /text-red-300/);
  assert.match(decisionStatusPresentation('PENDING').tone, /text-white\/45/);
  assert.match(decisionStatusPresentation('UNRECOGNIZED').tone, /text-white\/45/);
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
