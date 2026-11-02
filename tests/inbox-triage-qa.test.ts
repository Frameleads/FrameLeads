import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decisionStatusPresentation } from '../src/lib/decision/status-presentation';
import { formatIntentTemperature, intentTemperature, isHighPriorityIntent, resolveIntentTemperature } from '../src/lib/intent-temperature';
import { getDecisionProspectInterestScore } from '../src/lib/decision/intent-confidence';
import { getSignalChipStyle, getSignalChipTone } from '../src/app/dashboard/inbox-triage/signal-chip-style';
import { formatInboundReplyForDisplay } from '../src/app/dashboard/inbox-triage/inbound-reply-display';

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

test('Mobile and desktop layouts keep queue, packet, details, and actions responsive', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(panel, /sm:grid-cols-2/);
  assert.match(panel, /xl:grid-cols-\[minmax\(260px,1\.25fr\)/);
  assert.match(panel, /overflow-x-auto flex-nowrap/);
  assert.match(panel, /w-\[84vw\].*max-w-\[340px\].*sm:w-\[320px\]/);
  assert.match(panel, /senderInitials\(lead\.name\)/);
  assert.match(panel, /function receivedTime\(/);
  assert.match(panel, /aria-label=\{\x60Archive message from /);
  assert.match(panel, /aria-pressed=\{lead\.id === activeLeadId\}/);
  assert.match(panel, /grid min-w-0 grid-cols-1 items-stretch gap-y-6 xl:grid-cols-/);
  assert.match(panel, /xl:grid-rows-\[auto_minmax\(0,1fr\)\]/);
  assert.match(panel, /min-h-\[18rem\]/);
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
  assert.match(panel, /onClick=\{handleTrashArchived\}/);
});

test('Active lead cards retain timestamp, classification, favorites and archive/trash', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const schema = source('prisma/schema.prisma');
  const favoriteRoute = source('src/app/api/triage/favorite/route.ts');
  const archiveRoute = source('src/app/api/triage/archive/route.ts');
  const cardStart = panel.lastIndexOf('<article key={lead.id}');
  const card = panel.slice(cardStart, panel.indexOf('</article>', cardStart));
  assert.match(card, /queueIntentCategory\(lead\)/);
  assert.match(card, /<time dateTime=\{lead\.createdAt/);
  assert.doesNotMatch(card, />Review</);
  assert.match(card, /senderInitials\(lead\.name\)/);
  assert.match(card, /aria-pressed=\{Boolean\(lead\.isFavorite\)\}/);
  assert.match(card, /event\.stopPropagation\(\); void archiveSignal\(lead\.id\)/);
  assert.match(card, /event\.stopPropagation\(\); void trashSignal\(lead\.id\)/);
  assert.match(card, /event\.stopPropagation\(\); void toggleFavorite\(lead\)/);
  assert.match(panel, /isFavorite: Boolean\(s\.isFavorite\)/);
  assert.match(panel, /fetch\('\/api\/triage\/favorite'/);
  assert.match(schema, /isFavorite\s+Boolean\s+@default\(false\)/);
  assert.match(favoriteRoute, /where: \{ id, userId \}/);
  assert.match(archiveRoute, /status: "TRASHED"/);
});

test('Micro-Pilot preserves saved inbox and history with trial-specific restrictions', () => {
  const entitlements = source('src/lib/entitlements.ts');
  const page = source('src/app/dashboard/inbox-triage/page.tsx');
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(entitlements, /'INBOX_TRIAGE', 'DECISION_REPLAY'/);
  assert.match(page, /hasFeatureAccess\(userTier, 'INBOX_TRIAGE'\)/);
  assert.match(panel, /const hasInboxAccess = hasFeatureAccess\(userTier, 'INBOX_TRIAGE'\)/);
  assert.match(panel, /const \[pilotRemaining, setPilotRemaining\] = useState\(pilotDecisionsRemaining\)/);
  assert.match(panel, /One-Time Decision Allowance/);
  assert.match(panel, /hasSavedDecision/);
  assert.match(panel, /onNewPilotDecision/);
  assert.match(panel, /decision\.source !== 'UNAVAILABLE'/);
  assert.match(panel, /inboundSignal/);
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


test('Micro-Pilot shows real remaining trial allowance and interrupted analysis state', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const recovery = source('src/app/api/decisions/recovery/route.ts');
  assert.match(panel, /One-Time Decision Allowance/);
  assert.match(panel, /\{pilotDecisionsRemaining\}/);
  assert.match(panel, /of 3 prospect slots claimed/);
  assert.match(panel, /Review interrupted analysis/);
  assert.match(panel, /Recover analysis/);
  assert.match(panel, /AI response needs evidence verification/);
  assert.match(panel, /Policy review required · no governed reply has been approved/);
  assert.match(recovery, /entitlementError && user\.tier !== 'MICRO_PILOT'/);
});

test('All Inbox Triage tiers render manual action controls but Micro-Pilot sends remain protected', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const route = source('src/app/api/inbox/manual-send/route.ts');
  assert.match(panel, /const safeGovernedSuggestion = verifiedDecision && !unresolvedPolicy/);
  assert.match(panel, /const liveDraft = activeLead/);
  assert.match(panel, /manualDraftOverrides/);
  assert.match(panel, /onClick={handleRegenerate}/);
  assert.match(panel, /Approve &amp; Send/);
  assert.match(panel, /Confirm & Send/);
  assert.match(route, /user.tier === 'MICRO_PILOT'/);
  assert.match(route, /protected Micro-Pilot Sandbox send flow/);
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

test('Unresolved governance keeps truthful status while manual actions stay visible', () => {
  const ui = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(ui, /const unresolvedPolicy = Boolean\(decisionPacket\?\.reviewReasons\.includes\('POLICY_UNRESOLVED'\)\)/);
  assert.match(ui, /const safeGovernedSuggestion = verifiedDecision && !unresolvedPolicy/);
  assert.match(ui, /id="inbox-decision-packet" aria-label="Decision packet"/);
  assert.match(ui, /href="#inbox-decision-packet"/);
  assert.match(ui, /Decision requires policy review/);
  assert.match(ui, /Review Decision/);
  assert.match(ui, /handleRegenerate/);
  assert.match(ui, /showManualSendConfirm/);
  assert.match(ui, /manualApprovalReason/);
  assert.match(ui, /manualSendAcknowledged/);
  assert.match(ui, /getDecisionProspectInterestScore\(decision\)/);
});

test('Trash view lists preserved signals and safely restores only owner-matched trashed records', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const page = source('src/app/dashboard/inbox-triage/page.tsx');
  const restore = source('src/app/api/triage/restore/route.ts');
  const trash = source('src/app/api/triage/archive/route.ts');
  assert.match(page, /status: \{ in: \["PENDING", "ARCHIVED", "TRASHED"\] \}/);
  assert.match(panel, /queueView === 'trash'/);
  assert.match(panel, /Trash \(\{trashCount\}\)/);
  assert.match(panel, /Restore to Active/);
  assert.match(panel, /fetch\('\/api\/triage\/restore'/);
  assert.match(panel, /recordStatus: 'PENDING'/);
  assert.match(restore, /requireFeatureAccess\('INBOX_TRIAGE'\)/);
  assert.match(restore, /verifiedCustomerUser\(\)/);
  assert.match(restore, /updateMany\(\{/);
  assert.match(restore, /where: \{ id, userId, status: 'TRASHED' \}/);
  assert.match(restore, /data: \{ status: 'PENDING' \}/);
  assert.match(restore, /result\.count !== 1/);
  assert.match(trash, /data: \{ status: "TRASHED" \}/);
  assert.doesNotMatch(restore, /\.delete\(/);
});

test('Favorites tab provides persistent saved-lead view without altering Active/Archived workflow', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const page = source('src/app/dashboard/inbox-triage/page.tsx');
  const favoriteRoute = source('src/app/api/triage/favorite/route.ts');
  assert.match(panel, /'active' \| 'archived' \| 'favorites' \| 'trash'/);
  assert.match(panel, /queueView === 'favorites' \? Boolean\(lead\.isFavorite\)/);
  assert.match(panel, /lead\.recordStatus === 'PENDING' \|\| lead\.recordStatus === 'ARCHIVED'/);
  assert.match(panel, /Favorites \(\{favoritesCount\}\)/);
  assert.match(panel, /handleQueueViewChange\('favorites'\)/);
  assert.match(panel, /NO FAVORITES YET/);
  assert.match(panel, /nextFavorite \? 'Added to Favorites/);
  assert.match(panel, /queueView === 'favorites' && !nextFavorite && activeLeadId === lead\.id/);
  assert.match(panel, /lead\.recordStatus === 'PENDING' && <button/);
  assert.match(panel, /activeLead\.recordStatus === 'ARCHIVED' \? userTier/);
  assert.match(panel, /fetch\('\/api\/triage\/favorite'/);
  assert.match(page, /status: \{ in: \["PENDING", "ARCHIVED", "TRASHED"\] \}/);
  assert.match(favoriteRoute, /where: \{ id, userId \}/);
  assert.match(favoriteRoute, /data: \{ isFavorite: payload\.isFavorite \}/);
  assert.doesNotMatch(favoriteRoute, /status: ['"]ARCHIVED['"]|status: ['"]TRASHED['"]/);
});

test('Switching Inbox Triage queue tabs preserves locally saved favorites and selection', () => {
  const ui = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  // Only new server data may replace the local list. Queue navigation must
  // never reset a just-saved favorite to an older initialData snapshot.
  assert.match(ui, /useEffect\(\(\) => \{\s*setLeads\(dbLeads\);\s*\}, \[dbLeads\]\);/);
  assert.doesNotMatch(ui, /setLeads\(dbLeads\);[\s\S]{0,500}\}, \[dbLeads, queueView\]\);/);
  assert.match(ui, /const handleQueueViewChange = \(view: 'active' \| 'archived' \| 'favorites' \| 'trash'\)/);
  assert.match(ui, /queueView === 'favorites' \? Boolean\(lead\.isFavorite\)/);
  assert.match(ui, /Favorites \(\{favoritesCount\}\)/);
  assert.match(ui, /const updatedLeads = leads\.map\(item => item\.id === lead\.id \? \{ \.\.\.item, isFavorite: nextFavorite \} : item\);/);
  assert.match(ui, /setLeads\(updatedLeads\);/);
});

test('Why Now signal chips use semantic presentation without changing classification logic', () => {
  assert.equal(getSignalChipTone('Meeting Request'), 'meeting');
  assert.equal(getSignalChipTone('Demo Request'), 'meeting');
  assert.equal(getSignalChipTone('Positive Interest'), 'interest');
  assert.equal(getSignalChipTone('Interested'), 'interest');
  assert.equal(getSignalChipTone('Question'), 'question');
  assert.equal(getSignalChipTone('Negotiation'), 'commercial');
  assert.equal(getSignalChipTone('Pricing Inquiry'), 'commercial');
  assert.equal(getSignalChipTone('Timing Objection'), 'risk');
  assert.equal(getSignalChipTone('Unknown evidence'), 'neutral');
  assert.match(getSignalChipStyle('Meeting Request'), /text-amber-200/);
  assert.match(getSignalChipStyle('Positive Interest'), /text-emerald-200/);
  assert.match(getSignalChipStyle('Question'), /text-sky-200/);
  assert.match(getSignalChipStyle('Negotiation'), /text-orange-200/);
  assert.match(getSignalChipStyle('Risk'), /text-rose-200/);
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(panel, /getSignalChipStyle\(signal\)/);
  assert.match(panel, /displayedSignals\.map\(\(signal, index\)/);
});

test('Mobile draft controls remain spaced and manual actions stay available under review', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(panel, /flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5/);
  assert.match(panel, /min-w-0 w-full flex-1/);
  assert.match(panel, /shrink-0 items-center justify-center self-start/);
  assert.match(panel, /sm:self-auto/);
  assert.match(panel, /Approve &amp; Send/);
  assert.match(panel, /onClick=\{handleRegenerate\}/);
  assert.match(panel, /Human approval is required before sending/);
  assert.match(panel, /showManualSendConfirm/);
  assert.doesNotMatch(panel, /legacy send buttons are intentionally unavailable/);
});

test('Inbox Triage keeps all queue options in one compact desktop filter row', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.ok(panel.includes('xl:grid-cols-[minmax(260px,1.25fr)_minmax(185px,0.9fr)_minmax(158px,0.8fr)_minmax(365px,1.7fr)]'));
  assert.ok(panel.includes('xl:overflow-x-auto'), 'Smaller desktop widths must scroll horizontally, not stack the four filter groups');
  assert.ok(panel.includes('flex flex-nowrap items-center gap-1.5'));
  assert.ok(panel.includes('text-xs font-semibold'), 'Filter choices must use at least 12px labels');
  for (const view of ['active', 'archived', 'favorites', 'trash']) {
    assert.ok(panel.includes("handleQueueViewChange('" + view + "')"), 'Queue tab missing: ' + view);
  }
  assert.ok(panel.includes('Favorites ({favoritesCount})'));
  assert.ok(panel.includes('Trash ({trashCount})'));
});

test('Entity, inbound email and Intent Score borders match the subtle Decision Packet outline', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.ok(panel.includes('rounded-lg border border-white/[0.1] bg-[#121212] p-5 shadow-2xl'));
  assert.ok(panel.includes('h-full min-w-0 rounded-lg border border-white/[0.1] bg-[#121212]'));
  assert.ok(panel.includes('bg-[#1a1a1a] border border-white/[0.1] p-6 rounded-md'));
});

test('Inbound email view joins hard-wrapped lines without altering words or deliberate paragraph boundaries', () => {
  const raw = "Thanks for reaching out. This looks relevant to our agency. We’re an\n11-person team running multiple outbound campaigns, and I’m still reviewing\nimportant prospect replies myself.";
  assert.equal(formatInboundReplyForDisplay(raw),
    "Thanks for reaching out. This looks relevant to our agency. We’re an 11-person team running multiple outbound campaigns, and I’m still reviewing important prospect replies myself.");
  assert.equal(formatInboundReplyForDisplay("Hello,\r\nI can talk.\r\n\r\nRegards,\r\nMira"), "Hello, I can talk.\n\nRegards, Mira");
  assert.equal(formatInboundReplyForDisplay("Unbroken original text."), "Unbroken original text.");
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.ok(panel.includes('{formatInboundReplyForDisplay(inboundSignal)}'));
  assert.ok(!panel.includes('{formatInboundReplyForDisplay(reply)}'));
  assert.ok(!panel.includes('setInboundSignal(formatInboundReplyForDisplay('));
});

test('Decision Packet shows only analysis and review side by side, with no duplicated incoming email', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const packetPanel = panel.slice(panel.indexOf('function DecisionPacketPanel('), panel.indexOf('function SummaryCard('));
  assert.ok(packetPanel.includes('AI interpretation'));
  assert.ok(packetPanel.includes('Why human review'));
  assert.ok(!packetPanel.includes('Incoming reply</p>'));
  assert.ok(!packetPanel.includes('formatInboundReplyForDisplay(reply)'));
  assert.ok(!packetPanel.includes('font-heading text-xl font-semibold leading-8'));
  assert.ok(packetPanel.includes('completedInterpretation ? packet.interpretation'));
  assert.ok(packetPanel.includes("unverifiedModelOutput ? 'AI response needs evidence verification'"));
  assert.ok(packetPanel.includes('packet.explanation ?? packet.reviewReasons'));
  assert.ok(packetPanel.includes("rounded-xl border border-[#FF5A1F]/20 bg-[#FF5A1F]/[0.035] p-4 sm:p-5"));
  assert.ok(packetPanel.includes('break-words text-sm leading-6 text-white/75'));
  assert.ok(packetPanel.includes("font-mono text-[11px] uppercase tracking-[.12em] text-[#FF9A73]"));
  assert.ok(!packetPanel.includes('reply: string;'));
  assert.ok(panel.includes('>Inbound Signal</h2>'));
  assert.ok(panel.includes('{formatInboundReplyForDisplay(inboundSignal)}'));
});

test('Decision Packet icon labels remain readable and governance controls remain present', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.ok(panel.includes('font-mono text-[11px] uppercase tracking-[.12em] text-white/60">{label}'));
  assert.ok(panel.includes('label="Intent"'));
  assert.ok(panel.includes('label="Governance"'));
  assert.ok(panel.includes('label="Recommended action"'));
  assert.ok(panel.includes("packet.reviewReasons.includes('APPROVAL_REQUIRED')"));
  assert.ok(panel.includes("A relevant Sales Constitution rule could not be resolved from the available facts."));
});

test('Decision Packet has a compact full-width insight and responsive balanced review grid', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const packet = panel.slice(panel.indexOf('function DecisionPacketPanel('), panel.indexOf('function SummaryCard('));
  const interpretationAt = packet.indexOf('AI interpretation');
  const layoutAt = packet.indexOf('grid items-stretch gap-3 sm:grid-cols-2');
  const reviewAt = packet.indexOf('Why human review');
  assert.ok(interpretationAt > -1 && layoutAt > interpretationAt && reviewAt > layoutAt,
    'Interpretation should be full-width and compact, above the review/details grid');
  assert.ok(packet.includes("completedInterpretation ? 'sm:col-span-2 xl:col-span-2 xl:row-span-2'"));
  assert.ok(packet.includes("isReview && !interrupted && completedInterpretation ? 'xl:grid-cols-4' : 'xl:grid-cols-3'"));
  assert.ok(packet.includes("sm:col-span-2 xl:col-span-2' : 'sm:col-span-2 xl:col-span-1'"));
  assert.ok(!packet.includes('lg:grid-cols-[minmax(0,1.2fr)_minmax(250px,.8fr)]'));
  assert.ok(packet.includes('packet.explanation ?? packet.reviewReasons'));
  assert.ok(packet.includes('completedInterpretation ? packet.interpretation'));
  assert.ok(packet.includes('label="Intent"') && packet.includes('label="Governance"') && packet.includes('label="Recommended action"'));
  assert.ok(packet.includes('governanceNeedsReview && <p role="status"'));
});

test('Lower detail cards use the same subtle Decision Packet outline', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.ok(panel.includes('id="inbox-decision-packet" aria-label="Decision packet"'));
  assert.ok(panel.includes('border border-white/[0.1] bg-[#151515]'));
  assert.equal((panel.match(/border border-\[#888888\]/g) || []).length, 0);
  assert.ok(panel.includes('rounded-lg border border-white/[0.1] bg-[#121212]'));
  assert.ok(panel.includes('bg-[#1a1a1a] border border-white/[0.1]'));
  assert.ok(panel.includes('border-t border-[#888888] pt-6'));
});

test('Filter controls retain four queue tabs and neutral scrollbar on desktop and mobile', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const start = panel.indexOf('const queueTabs = (');
  const end = panel.indexOf('const archiveToastElement', start);
  const filterMarkup = panel.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(filterMarkup, /sm:grid-cols-2/);
  assert.match(filterMarkup, /xl:grid-cols-\[minmax\(260px,1\.25fr\)_minmax\(185px,0\.9fr\)_minmax\(158px,0\.8fr\)_minmax\(365px,1\.7fr\)\]/);
  for (const view of ['active', 'archived', 'favorites', 'trash']) {
    assert.ok(filterMarkup.includes("handleQueueViewChange('" + view + "')"));
  }
  assert.ok(filterMarkup.includes('Favorites ({favoritesCount})'));
  assert.ok(filterMarkup.includes('Trash ({trashCount})'));
  assert.ok(filterMarkup.includes('xl:overflow-x-auto'));
  assert.ok(!filterMarkup.includes('text-[10px] font-semibold'));
  assert.ok(!filterMarkup.includes('text-[11px] font-semibold'));
  assert.ok(filterMarkup.includes('flex flex-nowrap items-center gap-1.5'));
  const ribbon = panel.match(/aria-label="Inbound reply queue\.[^\n]*/)?.[0] ?? '';
  assert.ok(ribbon.includes('[&::-webkit-scrollbar-thumb]:bg-[#555555]'));
  assert.ok(ribbon.includes('hover:[&::-webkit-scrollbar-thumb]:bg-[#777777]'));
});

test('Lower detail sections share a two-column desktop grid with unchanged mobile reading order', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const entity = panel.indexOf('xl:col-start-1 xl:row-start-1');
  const inbound = panel.indexOf('xl:col-start-1 xl:row-start-2');
  const intent = panel.indexOf('xl:col-start-2 xl:row-start-1');
  const draft = panel.indexOf('xl:col-start-2 xl:row-start-2');
  assert.ok(panel.includes('xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]'));
  assert.ok(panel.includes('xl:grid-rows-[auto_minmax(0,1fr)]'));
  assert.ok(entity > -1 && inbound > entity && intent > inbound && draft > intent,
    'Mobile DOM order must remain Entity, Inbound, Intent, Draft');
  assert.ok(panel.includes('grid min-w-0 grid-cols-1 items-stretch'));
  // Existing container wrappers must not create competing flex-column heights.
  const lower = panel.slice(panel.indexOf('/* LEFT PANE: The Context Engine'),draft);
  assert.ok(!lower.includes('xl:w-2/5 flex flex-col space-y-8'));
  assert.ok(!lower.includes('xl:w-3/5 flex flex-col'));
});

test('All four lower-detail headings have aligned accessible icons and divider is #888888', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  for (const icon of ['Building2', 'Gauge', 'Mail', 'FilePenLine']) {
    assert.ok(panel.includes('<' + icon + ' aria-hidden="true" className="h-4 w-4 shrink-0 text-[#FF5A1F]" />'),
      'Missing icon: ' + icon);
  }
  for (const label of ['Entity Context', 'Intent Score', 'Inbound Signal', 'Draft Response']) {
    assert.ok(panel.includes(label), 'Missing lower-detail heading: ' + label);
  }
  assert.ok(panel.includes('gap-4 border-t border-[#888888] pt-6'));
  assert.ok(panel.includes('border border-white/[0.1]'), 'Do not alter card outline style');
  assert.ok(!panel.includes('[&::-webkit-scrollbar-thumb]:bg-[#FF5A1F]'));
});

test('Manual send always requires typed reason, confirmation and backend policy gate', () => {
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const route = source('src/app/api/inbox/manual-send/route.ts');
  const execution = source('src/lib/automation/actions.ts');
  const legacy = source('src/app/api/dispatch/route.ts');
  const footer = panel.slice(panel.indexOf('/* 5. The Action Buttons (Stacked natively at the bottom) */'));
  assert.ok(footer.includes('onClick={handleRegenerate}'));
  assert.ok(footer.includes('Approve &amp; Send'));
  assert.ok(footer.includes('Confirm & Send'));
  assert.ok(footer.includes('showManualSendConfirm'));
  assert.ok(footer.includes('manualSendAcknowledged'));
  assert.ok(footer.includes('href="#inbox-decision-packet"'));
  assert.ok(!footer.includes('governedDraftMode ? ('));
  assert.ok(panel.includes("fetch('/api/inbox/manual-send'"));
  assert.ok(!panel.includes("fetch('/api/dispatch'"));
  assert.ok(route.includes("getAuthenticatedEntitlementUser()"));
  assert.ok(route.includes("origin !== new URL(request.url).origin"));
  assert.ok(route.includes("featureAccessErrorForTier(user.tier, 'BASE_OUTBOUND')"));
  assert.ok(route.includes("status: 'PENDING'"));
  assert.ok(route.includes("inputMessage: { sourceType: 'INBOUND_SIGNAL', sourceId: signal.id }"));
  assert.ok(route.includes("latestDecision.id !== decisionId"));
  assert.ok(route.includes("confirmSend !== true"));
  assert.ok(route.includes("overrideReason.length < 12"));
  assert.ok(route.includes("action: 'EDIT_AND_SEND'"));
  assert.ok(execution.includes('function humanOverrideAllowed('));
  assert.ok(execution.includes('item.blockingRules.length || item.unresolvedRules.length'));
  assert.ok(execution.includes('evaluation.decision.primaryIntent === TriageIntent.UNSUBSCRIBE'));
  assert.ok(execution.includes('reason: input.overrideReason ?? null'));
  assert.ok(execution.includes('DecisionExecutionAttempt') || execution.includes('decisionExecutionAttempt.create'));
  assert.ok(execution.includes('sendNativeEmail'));
  assert.ok(legacy.includes('status: 410'));
  assert.ok(!legacy.includes("data: { status: 'APPROVED'"));
});
