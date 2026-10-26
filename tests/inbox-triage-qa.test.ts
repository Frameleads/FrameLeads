import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decisionStatusPresentation } from '../src/lib/decision/status-presentation';
import { formatIntentTemperature, intentTemperature, isHighPriorityIntent, resolveIntentTemperature } from '../src/lib/intent-temperature';
import { getDecisionProspectInterestScore } from '../src/lib/decision/intent-confidence';

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
  assert.match(route, /triageInboundSignal\(\{ userId, signalId: body\.signalId\.trim\(\),\s*retryOfDecisionId: body\.retryOfDecisionId \|\| undefined, microPilotReserved: isPilot \}/);
  assert.match(service, /if \(input\.retryOfDecisionId\)/);
  assert.match(service, /db\.decision\.update\(\{ where: \{ id: pending\.id/);
  assert.match(panel, /disabled=\{\(!packet \? !canAnalyze : !\(canReanalyze \|\| recoverablePilot\)\) \|\| running \|\| loading/);
  assert.match(panel, /setError\('Decision analysis failed/);
});

test('Mobile and desktop layouts keep queues, packet, chips, details, and actions responsive', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(panel, /grid[^"\n]*grid-cols-1[^"\n]*sm:grid-cols-2[^"\n]*xl:grid-cols-\[1\.5fr_1fr_1fr_1\.1fr\]/);
  assert.match(panel, /overflow-x-auto flex-nowrap/);
  assert.match(panel, /w-\[82vw\].*max-w-\[300px\].*sm:w-\[300px\]/);
  assert.match(panel, /min-h-\[18rem\]/);
  assert.match(panel, /max-w-full break-words font-heading/);
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


test('Micro-Pilot keeps all raw replies and existing decision history visible, locking only additional analysis', () => {
  const entitlements = source('src/lib/entitlements.ts');
  const page = source('src/app/dashboard/inbox-triage/page.tsx');
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(entitlements, /'INBOX_TRIAGE', 'DECISION_REPLAY'/);
  assert.match(page, /hasFeatureAccess\(userTier, 'INBOX_TRIAGE'\)/);
  assert.match(panel, /const hasInboxAccess = hasFeatureAccess\(userTier, 'INBOX_TRIAGE'\)/);
  assert.match(panel, /const \[pilotRemaining, setPilotRemaining\] = useState\(pilotDecisionsRemaining\)/);
  assert.match(panel, /One-Time Decision Allowance/);
  assert.match(panel, /!hasSavedDecision && isMicroPilot && pilotDecisionsRemaining === 0/);
  assert.match(panel, /hasSavedDecision \? 'Decision already recorded'/);
  assert.match(panel, /if \(isMicroPilot && !packet\) return;/);
  assert.match(panel, /if \(isMicroPilot && !result\.reused && result\.decision\.source !== 'UNAVAILABLE'\) onNewPilotDecision\(\)/);
  assert.match(panel, /<Link href=\{\`\/dashboard\/decisions\/\$\{encodeURIComponent\(packet\.id\)\}\/replay\`\}/);
  assert.match(panel, /\{inboundSignal\}/);
  assert.match(panel, /canReanalyze=\{userTier !== 'MICRO_PILOT'\}/);
});


test('interest scores require validated persisted AI evidence, never decision confidence', () => {
  const decision = { source: 'GEMINI', confidenceScore: 96,
    trace: { intentOutput: { prospectInterestScore: 74, confidence: 96,
      intents: [{ intent: 'PRICING_INQUIRY', evidence: 'What is your price?', confidence: 96 }] } } };
  assert.equal(getDecisionProspectInterestScore(decision), 74);
  assert.equal(getDecisionProspectInterestScore({ ...decision, trace: { intentOutput: { confidence: 96 } } }), null);
  assert.equal(getDecisionProspectInterestScore({ ...decision, source: 'DETERMINISTIC' }), null);
  assert.equal(getDecisionProspectInterestScore({ ...decision, trace: { intentOutput: { prospectInterestScore: 101 } } }), null);
  assert.equal(getDecisionProspectInterestScore({ ...decision, trace: { intentOutput: { prospectInterestScore: 0 } } }), 0);
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(panel, /getDecisionProspectInterestScore\(activeLead\?\.decisionPacket\)/);
  assert.match(panel, /'Not assessed'/);
  assert.match(panel, /Prospect buying interest, based on reply evidence/);
  assert.match(panel, /result\.reused/);
});


test('Micro-Pilot Decision packet reflects the server-authoritative remaining balance', () => {
  const ui = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const api = source('src/app/api/decisions/triage/route.ts');
  assert.match(api, /select: \{ microPilotDecisionsUsed: true \}/);
  assert.match(api, /Math\.max\(0, 3 - usage\.microPilotDecisionsUsed\)/);
  assert.match(ui, /typeof result\.remaining === 'number'/);
  assert.match(ui, /onNewPilotDecision\(result\.remaining\)/);
  assert.match(ui, /typeof serverRemaining === 'number'/);
});


test('Micro-Pilot shows a compact real decision allowance and honest interrupted state', () => {
  const page = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const recoveryRoute = source('src/app/api/decisions/recovery/route.ts');
  assert.match(page, /One-Time Decision Allowance/);
  assert.match(page, /\{pilotDecisionsRemaining\}/);
  assert.match(page, /of 3 prospect slots claimed/);
  assert.doesNotMatch(page, /Micro-Pilot decision proof: \{pilotDecisionsRemaining\}/);
  assert.match(page, /Review interrupted analysis/);
  assert.match(page, /Recover analysis/);
  assert.match(page, /AI response needs evidence verification/);
  assert.doesNotMatch(page, /No verified interpretation yet/);
  assert.match(page, /The model returned an unverified result/);
  assert.match(page, /Previous inbox score — not verified by the governed Decision Engine/);
  assert.match(page, /Previous triage draft — not verified by the Sales Constitution Decision/);
  assert.match(page, /completedInterpretation && <div/);
  assert.match(recoveryRoute, /entitlementError && user\.tier !== 'MICRO_PILOT'/);
});

test('Micro-Pilot draft displays only the governed saved suggestion; cannot use legacy approve/send route', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(panel, /const safeGovernedSuggestion = verifiedDecision && !unresolvedPolicy/);
  assert.match(panel, /typeof decisionPacket\?\.suggestedReply === 'string'/);
  assert.match(panel, /pilotDraftOverrides/);
  assert.match(panel, /Governed suggestion for review · not automatically sent/);
  assert.match(panel, /A governed draft is withheld until the necessary policy review is resolved/);
  assert.match(panel, /governedDraftMode \? \(/);
  assert.match(panel, /separately protected Sandbox sending path/);
  assert.match(panel, /Copy draft/);
});


test('Enterprise uses verified 65/100 interest instead of the older 52/100 COLD assessment', () => {
  const validated = { source: 'ANTHROPIC', primaryIntent: 'POSITIVE_INTEREST',
    trace: { intentOutput: { prospectInterestScore: 65, intents: [] } } };
  assert.equal(getDecisionProspectInterestScore(validated), 65);
  assert.equal(intentTemperature(65), 'WARM');
  assert.equal(intentTemperature(52), 'COLD');
  const ui = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(ui, /const verifiedDecision = Boolean\(activeLead\?\.decisionPacket\?\.trace\?\.intentOutput/);
  assert.match(ui, /verifiedDecision \|\| userTier === 'MICRO_PILOT' \? governedInterestScore : intentScore/);
  assert.match(ui, /formatIntentTemperature\(displayedIntentScore\)/);
  assert.match(ui, /queueIntentCategory\(lead\)/);
  assert.match(ui, /verifiedDecision && activeLead\?\.decisionPacket/);
  assert.match(ui, /Score measures expressed interest, not the likelihood of closing/);
});

test('unresolved policy explains withheld draft without reviving legacy send actions', () => {
  const ui = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(ui, /const unresolvedPolicy = Boolean\(decisionPacket\?\.reviewReasons\.includes\('POLICY_UNRESOLVED'\)\)/);
  assert.match(ui, /const safeGovernedSuggestion = verifiedDecision && !unresolvedPolicy/);
  assert.match(ui, /safeGovernedSuggestion \? pilotDraftOverrides\[decisionPacket\?\.id \?\? ''\]/);
  assert.match(ui, /governedDraftMode \? \(/);
  assert.match(ui, /legacy send buttons are intentionally unavailable/);
  assert.match(ui, /Human review required before treating any response as governed or approved/);
  assert.match(ui, /unresolvedRules/);
  assert.match(ui, /governanceHeadline/);
  assert.match(ui, /getDecisionProspectInterestScore\(decision\)/);
});
