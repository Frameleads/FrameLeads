import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('representative protected endpoints are guarded at their request boundary', () => {
  const endpoints: Array<[string, string]> = [
    ['src/app/api/scout/research/route.ts', 'PROSPECT_RESEARCH'],
    ['src/app/api/scout/qualify/route.ts', 'ICP'],
    ['src/app/api/brain/route.ts', 'BRAIN'],
    ['src/app/api/brain/[id]/route.ts', 'BRAIN'],
    ['src/app/api/playbook/rules/route.ts', 'PLAYBOOK'],
    ['src/app/api/constitution/rules/route.ts', 'CONSTITUTION_MANAGEMENT'],
    ['src/app/api/decisions/[decisionId]/replay/route.ts', 'DECISION_REPLAY'],
    ['src/app/api/outcome-learning/outcomes/route.ts', 'OUTCOME_CAPTURE'],
    ['src/app/api/outcome-learning/route.ts', 'OUTCOME_LEARNING'],
    ['src/app/api/market-profiles/route.ts', 'CUSTOM_MARKET_PROFILES'],
    ['src/app/api/automation/settings/route.ts', 'AUTOMATION'],
    ['src/app/api/revenue-risk/route.ts', 'REVENUE_RISK'],
    ['src/app/api/response-sla/settings/route.ts', 'RESPONSE_SLA'],
    ['src/app/api/decision-sandbox/route.ts', 'DECISION_SANDBOX'],
  ];
  for (const [path, feature] of endpoints)
    assert.ok(source(path).includes(`requireFeatureAccess('${feature}')`), `${path} must guard ${feature}`);
  const triage = source('src/app/api/decisions/triage/route.ts');
  assert.match(triage, /featureAccessErrorForTier\(entitlementUser\.tier, 'DECISION_ENGINE'\)/);
});

test('locked server pages decide access before loading premium data', () => {
  const guardedPages: Array<[string, string, string]> = [
    ['src/app/dashboard/scout/page.tsx', 'SCOUT', 'await listScoutProspects'],
    ['src/app/dashboard/scout/[id]/page.tsx', 'SCOUT', 'await getScoutProspect'],
    ['src/app/dashboard/scout/settings/page.tsx', 'ICP', 'await prisma.iCPProfile.findUnique'],
    ['src/app/dashboard/brain/page.tsx', 'BRAIN', 'const [brain, entries] = await Promise.all'],
    ['src/app/dashboard/playbook/page.tsx', 'PLAYBOOK', 'await getOrCreateRevenuePlaybook'],
    ['src/app/dashboard/constitution/page.tsx', 'CONSTITUTION_MANAGEMENT', 'await getOrCreateSalesConstitution'],
    ['src/app/dashboard/decisions/[decisionId]/replay/page.tsx', 'DECISION_REPLAY', 'await getDecisionReplay'],
  ];
  for (const [path, feature, premiumRead] of guardedPages) {
    const page = source(path);
    const accessCheck = page.indexOf(`hasFeatureAccess(tier, '${feature}')`);
    assert.ok(accessCheck >= 0 && accessCheck < page.indexOf(premiumRead), `${path} must gate before ${premiumRead}`);
    const lockedBranch = page.slice(accessCheck, page.indexOf(premiumRead));
    assert.match(lockedBranch, /Paywall/);
    assert.match(lockedBranch, /aria-hidden/);
  }
  const detail = source('src/app/dashboard/scout/[id]/page.tsx');
  assert.ok(detail.indexOf("hasFeatureAccess(tier, 'SCOUT')") < detail.indexOf('await getProspectMemoryContext'));
  assert.match(source('src/app/dashboard/decisions/[decisionId]/replay/page.tsx'), /getDecisionReplay/);
  assert.match(source('src/app/dashboard/brain/BrainEditor.tsx'), /if \(paywallLocked\) return;[\s\S]*?reload\(\)/);
});

test('direct entry points guard entitlement before provider or outbound work', () => {
  const cases: Array<[string, string, string]> = [
    ['src/app/api/magic-assist/route.ts', "requireFeatureAccess('BASE_OUTBOUND')", 'fetch(url'],
    ['src/app/api/email/send/route.ts', "requireFeatureAccess('BASE_OUTBOUND')", 'sendNativeEmail('],
    ['src/app/api/calendar/freebusy/route.ts', "requireFeatureAccess('INBOX_TRIAGE')", 'calendar.freebusy.query('],
  ];
  for (const [path, guard, effect] of cases) {
    const route = source(path);
    assert.ok(route.indexOf(guard) >= 0 && route.indexOf(guard) < route.indexOf(effect), `${path} must guard before ${effect}`);
  }
  const signal = source('src/app/api/ingestion/webhook/route.ts');
  assert.ok(signal.indexOf("hasFeatureAccess(tier, 'INBOX_TRIAGE')") < signal.indexOf('generateTrojanHorseDraft(signal)'));
  const replies = source('src/app/api/replies/ingest/route.ts');
  assert.ok(replies.indexOf("hasFeatureAccess(tier, 'DECISION_ENGINE')") < replies.indexOf('classifyReply(reply)'));
});

test('Decision triage only invokes Enterprise automation and packet UI only fetches it for Enterprise', () => {
  const route = source('src/app/api/decisions/triage/route.ts');
  assert.match(route, /if \(hasFeatureAccess\(entitlementUser\.tier, 'AUTOMATION'\)\)\s*\{[\s\S]*?runAutopilot/);
  assert.match(route, /if \(hasFeatureAccess\(entitlementUser\.tier, 'AUTOMATION'\)\)\s*\{[\s\S]*?assessRevenueAtRisk[\s\S]*?syncResponseSLAForDecision/);
  const panel = source('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  assert.match(panel, /if \(!isEnterpriseTier \|\| !packet\?\.id\) \{ setAutomation\(null\); return; \}/);
});

test('generation excludes Core-only context and tenant custom profiles for Micro', () => {
  const generate = source('src/app/api/generate/route.ts');
  assert.match(generate, /hasFeatureAccess\(tier, 'BRAIN'\)/);
  assert.match(generate, /hasFeatureAccess\(tier, 'PLAYBOOK'\)/);
  assert.match(generate, /hasFeatureAccess\(tier, 'CUSTOM_MARKET_PROFILES'\)/);
  assert.match(generate, /monthlyLeadQuotaForTier\(tier\)/);
});

test('automatic inbound triage checks the current tier and only Enterprise materializes Risk/SLA', () => {
  const scheduler = source('src/lib/decision/schedule.ts');
  assert.match(scheduler, /hasFeatureAccess\(tier, 'DECISION_ENGINE'\)/);
  assert.doesNotMatch(scheduler, /runAutopilot|sendNativeEmail|bookMeeting|automation\/actions/);
});

test('Micro-Pilot inbox routes authorize read/write mailbox access but skip all automatic paid AI work', () => {
  const credentials = source('src/app/api/inbox/credentials/route.ts');
  const sync = source('src/app/api/inbox/sync/route.ts');
  assert.match(credentials, /requireFeatureAccess\('INBOX_TRIAGE'\)/);
  assert.match(sync, /requireFeatureAccess\('INBOX_TRIAGE'\)/);
  assert.match(credentials, /resolvePublicImapHost\(requestedHost\)/);
  assert.match(credentials, /encrypt\(appPassword\)/);
  assert.match(sync, /decrypt\(user\.imapPassword\)/);
  assert.match(sync, /if \(tier !== 'MICRO_PILOT'\) scheduleInboundDecisions/);
  assert.match(sync, /if \(tier !== 'MICRO_PILOT'\) await Promise\.allSettled/);
  assert.match(sync, /rawEmail: cleanBody/);
  assert.match(sync, /sourceMessageId: \{/);
});

test('Micro-Pilot cannot use direct email dispatch or widen access through Core/Enterprise paywall wrappers', () => {
  const send = source('src/app/api/email/send/route.ts');
  assert.match(send, /getUserEntitlementTier\(user\.id\) === 'MICRO_PILOT'/);
  assert.ok(send.indexOf("getUserEntitlementTier(user.id) === 'MICRO_PILOT'") < send.indexOf('sendNativeEmail('));
  const core = source('src/components/CorePaywall.tsx');
  assert.match(core, /corePaywallFeatureForName\(featureName\)/);
  const enterprise = source('src/components/EnterprisePaywall.tsx');
  assert.match(enterprise, /featureName === 'Sales Constitution' \? 'CONSTITUTION_MANAGEMENT' : 'GOVERNANCE'/);
});

test('stalled Decision recovery is authenticated, tenant scoped, stale only, and requires explicit confirmation before a new version', () => {
  const recovery = source('src/app/api/decisions/recovery/route.ts');
  assert.match(recovery, /getAuthenticatedEntitlementUser\(\)/);
  assert.match(recovery, /userId: user\.id/);
  const service = source('src/lib/decision/pending-recovery.ts');
  assert.match(service, /STALLED_DECISION_AFTER_MS = 10 \* 60 \* 1000/);
  assert.match(service, /updateMany\([\s\S]*?userId: input\.userId[\s\S]*?status: 'PENDING'[\s\S]*?trace: \{ is: null \}/);
  assert.match(service, /ANALYSIS_OUTCOME_UNCERTAIN/);
  assert.doesNotMatch(service, /provider\.analyze|runAutopilot|sendNativeEmail/);
  const triage = source('src/app/api/decisions/triage/route.ts');
  assert.match(triage, /confirmProviderRequestEnded !== true/);
  assert.match(triage, /TRIAGE_UNCERTAIN_RETRY_CONFIRMED/);
});
