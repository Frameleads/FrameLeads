import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TriageIntent } from '@prisma/client';
import { validateTriageOutput, TRIAGE_SYSTEM_PROMPT,TRIAGE_RESPONSE_SCHEMA,TRIAGE_INTENTS,classifyTriageFailure,TriageProviderFailure,safeGoogleDiagnostic,safeTriageOutputDiagnostic,selectTriageProvider,createAnthropicTriageProvider } from '../src/lib/decision/provider';
import { decideReview, deterministicTriageSignal, triageInboundSignal,analyzeAndFinalizeReservedTriage } from '../src/lib/decision/triage';
import { materializeMessageInTransaction } from '../src/lib/decision/conversation';
import { canAutomaticallyTriage, canManuallyAnalyze, getDecisionRolloutMode } from '../src/lib/decision/rollout';
import { scheduleInboundDecisions } from '../src/lib/decision/schedule';
import { markStalledDecisionForReview, STALLED_DECISION_AFTER_MS, UNCERTAIN_ANALYSIS_REASON } from '../src/lib/decision/pending-recovery';

const answer = { primaryIntent: TriageIntent.PRICING_INQUIRY,
  intents: [{ intent: TriageIntent.PRICING_INQUIRY, confidence: 88, evidence: 'What is the price?' }],
  overallConfidence: 84, conciseInterpretation: 'Asks for pricing.',
  recommendedNextAction: 'ASK_CLARIFYING_QUESTION', suggestedReply: null,
  explanation: 'The reply asks about pricing.' };

test('Google diagnostics expose fixed vocabulary only, never raw messages or arbitrary metadata',()=>{
 const secret='sentinel-secret';
 const result=safeGoogleDiagnostic({status:400,statusText:'Bad Request',message:`response_schema rejected ${secret}`,
  errorDetails:[{reason:secret,domain:secret,metadata:{service:secret}}],headers:{authorization:secret},body:secret});
 assert.equal(result.reason,'SCHEMA_REJECTED');assert.equal(result.status,400);assert.ok(!JSON.stringify(result).includes(secret));
 assert.equal(safeGoogleDiagnostic({status:400,errorDetails:[{reason:'API_KEY_INVALID',domain:'googleapis.com',metadata:{service:'generativelanguage.googleapis.com'}}]}).reason,'API_KEY_INVALID');
 assert.equal(safeGoogleDiagnostic({status:429}).reason,'RATE_LIMIT');
 assert.equal(safeGoogleDiagnostic({status:402}).reason,'PAYMENT_REQUIRED');
 assert.equal(safeGoogleDiagnostic({status:403}).reason,'PERMISSION_DENIED');
 assert.equal(safeGoogleDiagnostic({status:400,message:'API key not valid'}).reason,'API_KEY_INVALID');
 assert.equal(safeGoogleDiagnostic({status:400,statusText:secret}).statusText,null);
});

test('triage output diagnostics expose fixed validation codes and never customer text', () => {
  const secret = 'pricing reply secret';
  assert.equal(safeTriageOutputDiagnostic(new TypeError(`Intent evidence is not in the reply: ${secret}`)), 'OUTPUT_VALIDATION_FAILED');
  assert.equal(safeTriageOutputDiagnostic(new TypeError('Intent evidence is not in the reply')), 'EVIDENCE_NOT_IN_CURRENT_REPLY');
  assert.equal(safeTriageOutputDiagnostic(new SyntaxError(secret)), 'JSON_PARSE_FAILED');
  assert.equal(safeTriageOutputDiagnostic(new TriageProviderFailure('OUTPUT_TRUNCATED')), 'OUTPUT_VALIDATION_FAILED');
  assert.ok(!JSON.stringify([safeTriageOutputDiagnostic(new TypeError(secret))]).includes(secret));
});

function fixture(variation: { answer?: unknown; policy?: 'allow' | 'review' | 'block';
  providerError?: boolean; tenant?: string; sourceType?: string; signalType?: string; reply?: string } = {}) {
  const rows: any[] = [];
  const usage: any[] = [];
  let calls = 0;
  const signal = { id: 'signal-1', userId: 'tenant-a', prospectId: 'prospect-a', rawEmail: variation.reply ?? 'What is the price?',
    sourceMessageId: 'source-1', sourceType: variation.sourceType ?? 'WEBHOOK',
    signalType: variation.signalType ?? 'EMAIL_REPLY', createdAt: new Date('2026-01-01') };
  const message = { id: 'message-1', userId: 'tenant-a', conversationId: 'conversation-1',
    prospectId: 'prospect-a', sourceType: 'INBOUND_SIGNAL', sourceId: signal.id, body: signal.rawEmail,
    occurredAt: signal.createdAt };
  const conversation = { id: 'conversation-1', userId: 'tenant-a', prospectId: 'prospect-a', lastMessageAt: signal.createdAt };
  const db: any = {
    user: { findUnique: async () => ({ tier: 'CORE' }) },
    $transaction: async (work: any) => work(db),
    prospect: { findUnique: async ({ where }: any) => where.userId_id.userId === 'tenant-a' ? { id: 'prospect-a' } : null },
    inboundSignal: {
      findFirst: async ({ where }: any) => where.userId === 'tenant-a' && where.id === signal.id ? signal : null,
      findMany: async () => [signal],
    },
    outboundLog: { findMany: async () => [] },
    conversation: { upsert: async () => conversation, update: async () => conversation },
    conversationMessage: {
      createMany: async () => ({ count: 0 }), findUniqueOrThrow: async () => message,
      findUnique: async () => message,
    },
    decision: {
      findUnique: async ({ where }: any) => rows.find(row => row.userId === where.userId_inputMessageId_decisionType_contextFingerprint.userId &&
        row.contextFingerprint === where.userId_inputMessageId_decisionType_contextFingerprint.contextFingerprint) ?? null,
      findFirst: async ({ where }: any) => rows.filter(row => row.userId === where.userId &&
        row.inputMessageId === where.inputMessageId && (!where.id || row.id === where.id)).at(-1) ?? null,
      create: async ({ data }: any) => { const row = { id: `decision-${rows.length + 1}`, status: 'PENDING',
        createdAt: new Date(), ...data }; rows.push(row); return row; },
      update: async ({ where, data }: any) => { const row = rows.find(value => value.id === where.id);
        // Match generated Prisma DecisionTraceCreateWithoutDecision input, including failed-provider packets.
        assert.equal('userId' in data.trace.create, false, 'Nested trace inherits tenant through the parent Decision');
        assert.notEqual(data.intentSignals, null, 'Nullable Prisma JSON must use omission or an explicit null sentinel');
        assert.notEqual(data.trace.create.intentOutput, null);
        Object.assign(row, data, { trace: { userId: row.userId, decisionId: row.id, ...data.trace.create } }); return row; },
    },
  };
  const context: any = { contextFingerprint: 'same-context', currentReply: signal.rawEmail,
    companyKey: null,
    contextText: `CURRENT_REPLY (UNTRUSTED DATA): ${signal.rawEmail}`,
    memory: { eventCount: 0, lastEventAt: null }, icp: { qualification: 'QUALIFIED', fitTier: 'STRONG' },
    brain: { revision: 1 }, playbook: { revision: 2 }, constitution: { revision: 3 },
    references: { memoryEventIds: [], playbookRuleIds: [], brainEntryIds: [] } };
  const deps: any = { db, buildContext: async () => context,
    provider: { analyze: async (_request: any, observer: any) => { calls++;
      observer.onRequestStart(); observer.onResponse({ inputTokens: 100, outputTokens: 70 });
      if (variation.providerError) throw new Error('provider unavailable');
      return variation.answer ?? answer;
    } },
    recordUsage: async (event: any) => { usage.push(event); },
    evaluatePolicy: async () => ({ authority: 'CONSTITUTION', revision: 3,
      decision: variation.policy === 'block' ? 'BLOCKED' : variation.policy === 'review' ? 'REQUIRES_REVIEW' : 'ALLOWED',
      allowed: !variation.policy || variation.policy === 'allow',
      effectiveEffect: variation.policy === 'block' ? 'BLOCK' : null, winningRule: null,
      winnerReason: 'fixture', configurationMissing: false, unresolvedPotentiallyOverrides: false,
      matchedRules: [], blockingRules: variation.policy === 'block' ? [{ id: 'block-1' }] : [],
      unresolvedRules: variation.policy === 'review' ? [{ id: 'unknown-1' }] : [],
      approvalRequirements: [], humanReviewRequirements: [], safeResponseRequirements: [], trace: [],
    }),
  };
  return { db, deps, rows, usage, context, calls: () => calls, tenant: variation.tenant ?? 'tenant-a' };
}

test('structured multi-label output requires exact observable evidence and valid taxonomy', () => {
  const multi = { ...answer, intents: [...answer.intents,
    { intent: TriageIntent.POSITIVE_INTEREST, confidence: 79, evidence: 'What is' }] };
  assert.equal(validateTriageOutput(multi, 'What is the price?').intents.length, 2);
  assert.throws(() => validateTriageOutput({ ...answer, intents: [{ ...answer.intents[0], evidence: 'Discount approved' }] },
    'What is the price?'), /evidence is not in the reply/);
  assert.throws(() => validateTriageOutput({ ...answer, overallConfidence: 105 }, 'What is the price?'), /confidence/);
  assert.throws(() => validateTriageOutput({ ...answer, extra: true }, 'What is the price?'), /Unexpected/);
  assert.throws(() => validateTriageOutput({ ...answer, intents: [] }, 'What is the price?'), /Invalid intent list/);
  assert.throws(() => validateTriageOutput({ ...answer, intents: Array(6).fill(answer.intents[0]) }, 'What is the price?'), /Invalid intent list/);
  assert.throws(() => validateTriageOutput({ ...answer, intents: [{...answer.intents[0],intent:'COMMITMENT'}] }, 'What is the price?'), /Invalid intent/);
});

test('canonical schema enumerates the server taxonomy and prevents invented COMMITMENT intent',()=>{
 assert.deepEqual(TRIAGE_INTENTS,Object.values(TriageIntent));
 const schema:any=TRIAGE_RESPONSE_SCHEMA;
 assert.deepEqual(schema.properties.primaryIntent.enum,Object.values(TriageIntent));
 assert.deepEqual(schema.properties.intents.items.properties.intent.enum,Object.values(TriageIntent));
 for(const intent of Object.values(TriageIntent))assert.ok(TRIAGE_SYSTEM_PROMPT.includes(intent));
 assert.throws(()=>validateTriageOutput({...answer,primaryIntent:'COMMITMENT'},'What is the price?'),/Invalid primary intent/);
 assert.throws(()=>validateTriageOutput({...answer,intents:[{...answer.intents[0],evidence:'what is the price?'}]},'What is the price?'),/evidence/);
});
test('safe failure classification contains no raw provider/customer data',()=>{
 assert.equal(classifyTriageFailure(new TriageProviderFailure('MISSING_API_KEY'),'PROVIDER'),'MISSING_API_KEY');
 assert.equal(classifyTriageFailure({status:403,message:'private'},'PROVIDER'),'AUTH_FAILED');
 assert.equal(classifyTriageFailure({status:503},'PROVIDER'),'PROVIDER_5XX');
 assert.equal(classifyTriageFailure({name:'AbortError'},'PROVIDER'),'PROVIDER_TIMEOUT');
 assert.equal(classifyTriageFailure(new TypeError('private'),'PROVIDER'),'PROVIDER_NETWORK');
 assert.equal(classifyTriageFailure(new SyntaxError('private'),'PROVIDER'),'JSON_PARSE_FAILED');
 assert.equal(classifyTriageFailure(new TypeError('private'),'VALIDATION'),'OUTPUT_VALIDATION_FAILED');
 assert.equal(classifyTriageFailure(new Error('private'),'PROVIDER'),'UNKNOWN_PROVIDER_FAILURE');
});
test('explicit Anthropic selection and bounded provider failures preserve inactive Gemini support',()=>{
 const previous=process.env.TRIAGE_AI_PROVIDER;
 try{process.env.TRIAGE_AI_PROVIDER='ANTHROPIC';assert.equal(selectTriageProvider().provider,'ANTHROPIC');
  process.env.TRIAGE_AI_PROVIDER='GEMINI';assert.equal(selectTriageProvider().provider,'GEMINI');
  assert.equal(createAnthropicTriageProvider('claude-haiku-4-5').model,'claude-haiku-4-5');
  assert.equal(classifyTriageFailure({status:402},'PROVIDER'),'CREDIT_OR_BILLING_REQUIRED');
  assert.equal(classifyTriageFailure({status:400,message:'Your credit balance is too low: secret'},'PROVIDER'),'CREDIT_OR_BILLING_REQUIRED');
  assert.equal(classifyTriageFailure({status:429},'PROVIDER'),'RATE_LIMIT');
 }finally{if(previous===undefined)delete process.env.TRIAGE_AI_PROVIDER;else process.env.TRIAGE_AI_PROVIDER=previous;}
});
test('Claude finalizes the existing reservation with Anthropic source and actual usage metadata',async()=>{
 const f=fixture();f.context.constitution.revision=1;
 Object.assign(f.deps.provider,{provider:'ANTHROPIC',model:'claude-haiku-4-5'});
 const pending:any={id:'existing',userId:'tenant-a',status:'PENDING'};f.rows.push(pending);
 const policy=f.deps.evaluatePolicy;f.deps.evaluatePolicy=async()=>({...await policy(),authority:'SALES_CONSTITUTION',revision:1});
 f.db.decision.create=async()=>{throw Error('Cannot reserve another Decision');};
 const linked:any={signal:{prospectId:'prospect-a',sourceType:'IMAP_NATIVE',signalType:'EMAIL_REPLY'},message:{id:'message-1'},conversation:{id:'conversation-1'}};
 const result=await analyzeAndFinalizeReservedTriage({userId:'tenant-a',linked,context:f.context,pending,fingerprint:'same',strictRecovery:true},f.deps);
 assert.equal(result.decision!.source,'ANTHROPIC');assert.equal(result.decision!.provider,'ANTHROPIC');assert.equal(result.decision!.model,'claude-haiku-4-5');
 assert.equal(f.usage[0].provider,'ANTHROPIC');assert.equal(f.usage[0].model,'claude-haiku-4-5');assert.equal(f.usage[0].status,'SUCCESS');assert.equal(f.rows.length,1);
});
test('shared C/D/E finalizes the existing PENDING row and creates one trace without reservation',async()=>{
 const f=fixture();f.context.constitution.revision=1;
 const pending:any={id:'existing',userId:'tenant-a',status:'PENDING'};f.rows.push(pending);
 const policy=f.deps.evaluatePolicy;f.deps.evaluatePolicy=async()=>({...await policy(),authority:'SALES_CONSTITUTION',revision:1});
 f.db.decision.create=async()=>{throw Error('Recovery cannot reserve');};
 const linked:any={signal:{userId:'tenant-a',prospectId:'prospect-a',sourceType:'IMAP_NATIVE',signalType:'EMAIL_REPLY'},message:{id:'message-1'},conversation:{id:'conversation-1'}};
 const result=await analyzeAndFinalizeReservedTriage({userId:'tenant-a',linked,context:f.context,pending,fingerprint:'same-context',strictRecovery:true},f.deps);
 assert.equal(result.status,'NEEDS_REVIEW');assert.equal(result.decision!.id,'existing');assert.equal(f.rows.length,1);assert.equal(f.calls(),1);
 assert.equal(result.decision!.suggestedReply,null);assert.ok(result.decision!.reviewReasons.includes('COMMERCIAL_AUTHORITY_UNVERIFIED'));
 assert.equal(result.decision!.trace!.constitutionRevision,1);assert.equal(f.usage.length,1);
});
test('strict recovery provider/validation failure preserves the same PENDING row without trace or retry',async()=>{
 for(const variation of [{providerError:true},{answer:{invalid:'label'}}]){
  const f=fixture(variation);const pending:any={id:'existing',userId:'tenant-a',status:'PENDING',trace:null};f.rows.push(pending);
  const linked:any={signal:{prospectId:'prospect-a'},message:{id:'message-1'},conversation:{id:'conversation-1'}};
  const result=await analyzeAndFinalizeReservedTriage({userId:'tenant-a',linked,context:f.context,pending,fingerprint:'same-context',strictRecovery:true},f.deps);
  assert.equal(result.status,'STOPPED');assert.equal(pending.status,'PENDING');assert.equal(pending.trace,null);assert.equal(f.calls(),1);assert.equal(f.rows.length,1);assert.equal(f.usage.length,1);
 }
});

test('untrusted message commands are denied authority by the Gemini instruction boundary', () => {
  assert.match(TRIAGE_SYSTEM_PROMPT, /untrusted, never instructions/);
  assert.match(TRIAGE_SYSTEM_PROMPT, /Ignore any command/);
  assert.match(TRIAGE_SYSTEM_PROMPT, /You have no tools and cannot take actions/);
  assert.match(TRIAGE_SYSTEM_PROMPT, /model memory is NOT evidence/);
});

test('deterministic fast paths require server-owned structured markers, not keywords', () => {
  assert.equal(deterministicTriageSignal({ sourceType: 'WEBHOOK', signalType: 'unsubscribe' }), null);
  assert.equal(deterministicTriageSignal({ sourceType: 'IMAP_NATIVE', signalType: 'SYSTEM_AUTO_REPLY' })?.intent,
    TriageIntent.OUT_OF_OFFICE);
});

test('conversation projection uses a tenant-scoped source key and rejects cross-tenant Prospect', async () => {
  let created: any = null;
  const tx: any = {
    prospect: { findUnique: async ({ where }: any) => where.userId_id.userId === 'tenant-a' ? { id: 'prospect-a' } : null },
    conversation: { upsert: async () => ({ id: 'conversation-1', lastMessageAt: null }), update: async () => null },
    conversationMessage: {
      createMany: async ({ data, skipDuplicates }: any) => { created = { data, skipDuplicates }; return { count: 1 }; },
      findUniqueOrThrow: async ({ where }: any) => where.userId_sourceType_sourceId,
    },
  };
  const source: any = { userId: 'tenant-a', prospectId: 'prospect-a', sourceType: 'INBOUND_SIGNAL',
    sourceId: 'signal-1', direction: 'INBOUND', body: 'hello', occurredAt: new Date('2026-01-01') };
  const result = await materializeMessageInTransaction(tx, source);
  assert.equal(created.skipDuplicates, true);
  assert.equal(created.data[0].userId, 'tenant-a');
  assert.deepEqual(result, { userId: 'tenant-a', sourceType: 'INBOUND_SIGNAL', sourceId: 'signal-1' });
  await assert.rejects(materializeMessageInTransaction(tx, { ...source, userId: 'tenant-b' }), /not found/);
});

test('low confidence and policy uncertainty require review', () => {
  assert.deepEqual(decideReview({ analysis: { ...answer, overallConfidence: 40 } as any, policy: [] }),
    ['LOW_CONFIDENCE', 'COMMERCIAL_AUTHORITY_UNVERIFIED']);
  assert.ok(decideReview({ analysis: answer as any, policy: [{ decision: 'REQUIRES_REVIEW',
    unresolvedRules: [{}], blockingRules: [], approvalRequirements: [], humanReviewRequirements: [],
    safeResponseRequirements: [] }] }).includes('POLICY_UNRESOLVED'));
});

test('tenant isolation rejects another tenant before provider use', async () => {
  const f = fixture({ tenant: 'tenant-b' });
  await assert.rejects(triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps), /not found/);
  assert.equal(f.calls(), 0);
});

test('trusted auto-reply marker bypasses Gemini and usage telemetry', async () => {
  const f = fixture({ sourceType: 'IMAP_NATIVE', signalType: 'SYSTEM_AUTO_REPLY' });
  const result = await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps);
  assert.equal(result.decision?.source, 'DETERMINISTIC');
  assert.equal(result.decision?.primaryIntent, TriageIntent.OUT_OF_OFFICE);
  assert.equal(f.calls(), 0);
  assert.equal(f.usage.length, 0);
});

test('one provider call, persisted trace, cache reuse, and explicit new version', async () => {
  const f = fixture();
  const first = await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps);
  assert.equal(first.status, 'NEEDS_REVIEW');
  assert.equal(first.decision?.suggestedReply, null);
  assert.ok(first.decision?.reviewReasons.includes('COMMERCIAL_AUTHORITY_UNVERIFIED'));
  assert.equal(first.decision?.trace?.engineVersion, 'reply-decision-v1');
  assert.equal(first.decision?.shadowMode, true);
  assert.equal(f.calls(), 1); assert.equal(f.usage.length, 1);
  const second = await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps);
  assert.equal(second.reused, true); assert.equal(f.calls(), 1);
  const retried = await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1',
    retryOfDecisionId: first.decision!.id }, f.deps);
  assert.equal(retried.decision?.supersedesDecisionId, first.decision?.id);
  assert.equal(f.rows.length, 2); assert.equal(f.calls(), 2);
  assert.equal(f.rows[0].status, 'NEEDS_REVIEW');
  assert.equal(f.rows[0].contextFingerprint, 'same-context');
});

test('commercial pricing and negotiation drafts require human review and cannot enter Autopilot', async () => {
  const reply = 'What is the price?';
  const f = fixture({ answer: { ...answer, intents: [
    ...answer.intents,
    { intent: TriageIntent.POSITIVE_INTEREST, confidence: 82, evidence: 'price?' },
    { intent: TriageIntent.NEGOTIATION, confidence: 78, evidence: 'price' },
  ], recommendedNextAction: 'REPLY_WITH_FACTS',
  suggestedReply: 'Our sales team can walk you through our pricing packages.' } });
  const result = await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.decision?.status, 'NEEDS_REVIEW');
  assert.equal(result.decision?.suggestedReply, null);
  assert.equal(result.decision?.recommendedNextAction, 'ESCALATE_TO_HUMAN');
  assert.ok(result.decision?.reviewReasons.includes('COMMERCIAL_AUTHORITY_UNVERIFIED'));
  assert.equal(f.calls(), 1);
});

test('duplicate inbound processing reserves one Decision and makes one provider request', async () => {
  const f = fixture();
  const create = f.db.decision.create;
  f.db.decision.create = async ({ data }: any) => {
    if (f.rows.length) throw Object.assign(new Error('unique decision reservation'), { code: 'P2002' });
    return create({ data });
  };
  const results = await Promise.all([
    triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps),
    triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps),
  ]);
  assert.equal(f.rows.length, 1);
  assert.equal(f.calls(), 1);
  assert.ok(results.every(result => result.decision?.id === f.rows[0].id));
});

test('ten controlled inbound scenarios validate through canonical analysis and retain review policy', async () => {
  const commercialIntents: TriageIntent[] = [TriageIntent.PRICING_INQUIRY, TriageIntent.PRICING_OBJECTION,
    TriageIntent.BUDGET_OBJECTION, TriageIntent.NEGOTIATION];
  const scenarios: Array<[string, TriageIntent, string]> = [
    ['What is the price for the annual plan?', TriageIntent.PRICING_INQUIRY, 'What is the price'],
    ['Can we meet Tuesday afternoon?', TriageIntent.MEETING_REQUEST, 'meet Tuesday afternoon'],
    ['Please send your security and SOC 2 information.', TriageIntent.SECURITY, 'security and SOC 2'],
    ['We need to negotiate the renewal terms.', TriageIntent.NEGOTIATION, 'negotiate the renewal terms'],
    ['We are not interested. Please close this out.', TriageIntent.NOT_INTERESTED, 'not interested'],
    ['Maybe. I am not sure what you mean.', TriageIntent.CONFUSED, 'not sure what you mean'],
    ['Unsubscribe me from all messages.', TriageIntent.UNSUBSCRIBE, 'Unsubscribe me'],
    ['This may be a better fit next quarter.', TriageIntent.TIMING_OBJECTION, 'next quarter'],
    ['I am not the right person for this.', TriageIntent.WRONG_PERSON, 'not the right person'],
    ['We already use a different integration provider.', TriageIntent.INTEGRATION_QUESTION, 'different integration provider'],
  ];
  for (const [reply, intent, evidence] of scenarios) {
    const f = fixture({ reply, answer: { ...answer, primaryIntent: intent,
      intents: [{ intent, confidence: 80, evidence }], conciseInterpretation: `Scenario: ${intent}` } });
    const result = await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps);
    assert.equal(result.decision?.primaryIntent, intent, reply);
    assert.equal(f.rows.length, 1, reply);
    assert.equal(f.calls(), 1, reply);
    assert.ok(result.decision?.trace, reply);
    const requiresCommercialReview = commercialIntents.includes(intent);
    assert.equal(result.decision?.status, requiresCommercialReview ? 'NEEDS_REVIEW' : 'READY', reply);
    if (requiresCommercialReview) {
      assert.equal(result.decision?.suggestedReply, null, reply);
      assert.ok(result.decision?.reviewReasons.includes('COMMERCIAL_AUTHORITY_UNVERIFIED'), reply);
    }
  }
});

test('changed context revision is captured by explicit re-triage without rewriting history', async () => {
  const f = fixture();
  const initial = await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps);
  f.context.contextFingerprint = 'revised-context';
  f.context.brain.revision = 4;
  const next = await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1',
    retryOfDecisionId: initial.decision!.id }, f.deps);
  assert.notEqual(next.decision?.id, initial.decision?.id);
  assert.equal(initial.decision?.trace?.brainRevision, 1);
  assert.equal(next.decision?.trace?.brainRevision, 4);
  assert.equal(f.rows.length, 2);
});

test('multi-label intent and confidence survive persistence', async () => {
  const f = fixture({ answer: { ...answer, intents: [...answer.intents,
    { intent: TriageIntent.POSITIVE_INTEREST, confidence: 75, evidence: 'What is' }] } });
  const result = await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps);
  assert.equal(result.decision?.primaryIntent, TriageIntent.PRICING_INQUIRY);
  assert.deepEqual(result.decision?.secondaryIntents, [TriageIntent.POSITIVE_INTEREST]);
  assert.equal(result.decision?.confidenceScore, 84);
  assert.equal((result.decision?.trace?.intentOutput as any).intents.length, 2);
});

test('low confidence creates review packet and no false readiness', async () => {
  const f = fixture({ answer: { ...answer, overallConfidence: 30 } });
  const result = await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.decision?.requiresReview, true);
  assert.ok(result.decision?.reviewReasons.includes('LOW_CONFIDENCE'));
});

test('Constitution review outcome is visible and cannot authorize model draft', async () => {
  const f = fixture({ policy: 'review', answer: { ...answer, suggestedReply: 'A proposed answer.' } });
  const result = await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.decision?.recommendedNextAction, 'ESCALATE_TO_HUMAN');
  assert.equal(result.decision?.suggestedReply, null);
  assert.ok(result.decision?.reviewReasons.includes('POLICY_UNRESOLVED'));
});

test('invalid output and provider failure fail into review without false semantics', async () => {
  for (const variation of [{ answer: { ...answer, primaryIntent: 'MADE_UP' } }, { providerError: true }]) {
    const f = fixture(variation);
    const result = await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps);
    assert.equal(result.status, 'NEEDS_REVIEW');
    assert.equal(result.decision?.primaryIntent, null);
    assert.equal(result.decision?.suggestedReply, null);
    assert.equal(f.calls(), 1); assert.equal(f.usage.length, 1);
  }
});

test('Constitution block overrides candidate action and suppresses draft', async () => {
  const f = fixture({ policy: 'block', answer: { ...answer, suggestedReply: 'Here is a proposed reply.' } });
  const result = await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.decision?.recommendedNextAction, 'NO_SALES_OUTREACH');
  assert.equal(result.decision?.suggestedReply, null);
  assert.ok(result.decision?.reviewReasons.includes('POLICY_BLOCKED'));
  assert.equal((result.decision?.trace?.policyResult as any)[0].action, 'TOPIC_RESPONSE:PRICING');
});

test('migration is additive and preserves legacy inbound and outbound tables', () => {
  const sql = readFileSync(join(process.cwd(), 'prisma/migrations/20260928160000_decision_engine_v1/migration.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE "Conversation"/);
  assert.match(sql, /CREATE TABLE "DecisionTrace"/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE "InboundSignal"|ALTER TABLE "OutboundLog"/i);
});

test('rollout defaults to MANUAL and accepts only explicit server-owned modes', () => {
  assert.equal(getDecisionRolloutMode(''), 'MANUAL');
  assert.equal(getDecisionRolloutMode('unexpected'), 'MANUAL');
  assert.equal(canAutomaticallyTriage('MANUAL'), false);
  assert.equal(canAutomaticallyTriage('DISABLED'), false);
  assert.equal(canAutomaticallyTriage('SHADOW_AUTO'), true);
  assert.equal(canManuallyAnalyze('MANUAL'), true);
  assert.equal(canManuallyAnalyze('SHADOW_AUTO'), true);
  assert.equal(canManuallyAnalyze('DISABLED'), false);
});

test('MANUAL and DISABLED schedule no automatic triage or usage; SHADOW_AUTO schedules once per signal', async () => {
  const original = process.env.DECISION_ENGINE_ROLLOUT_MODE;
  const queued: (() => Promise<void>)[] = [];
  const analyzed: string[] = [];
  const deps: any = { enqueue: (task: () => Promise<void>) => { queued.push(task); },
    tier: async () => 'CORE',
    triage: async ({ signalId }: any) => { analyzed.push(signalId); } };
  try {
    delete process.env.DECISION_ENGINE_ROLLOUT_MODE;
    scheduleInboundDecisions('tenant-a', ['signal-1'], deps);
    assert.equal(queued.length, 0);
    process.env.DECISION_ENGINE_ROLLOUT_MODE = 'DISABLED';
    scheduleInboundDecisions('tenant-a', ['signal-1'], deps);
    assert.equal(queued.length, 0);
    process.env.DECISION_ENGINE_ROLLOUT_MODE = 'SHADOW_AUTO';
    scheduleInboundDecisions('tenant-a', ['signal-1', 'signal-1', 'signal-2'], deps);
    assert.equal(queued.length, 1);
    await queued[0]();
    assert.deepEqual(analyzed.sort(), ['signal-1', 'signal-2']);
  } finally {
    if (original === undefined) delete process.env.DECISION_ENGINE_ROLLOUT_MODE;
    else process.env.DECISION_ENGINE_ROLLOUT_MODE = original;
  }
});

test('ANALYSIS_AUTO is explicit and automatic scheduler never evaluates execution', async () => {
  assert.equal(getDecisionRolloutMode('ANALYSIS_AUTO'), 'ANALYSIS_AUTO');
  assert.equal(canAutomaticallyTriage('ANALYSIS_AUTO'), true);
  const schedule = readFileSync(join(process.cwd(), 'src/lib/decision/schedule.ts'), 'utf8');
  assert.doesNotMatch(schedule, /runAutopilot|sendNativeEmail|bookMeeting|automation\/actions/);
});

test('stalled PENDING recovery is tenant-scoped, atomic, preserves the reservation and never calls a provider', async () => {
  const now = new Date('2026-10-20T10:00:00.000Z');
  const row: any = { id: 'd1', status: 'PENDING', createdAt: new Date(now.getTime() - STALLED_DECISION_AFTER_MS - 1),
    updatedAt: new Date(now.getTime() - STALLED_DECISION_AFTER_MS - 1), reviewReasons: [], trace: null };
  const calls: any[] = [];
  const db: any = {
    decision: {
      findFirst: async ({ where }: any) => { calls.push({ find: where }); return where.userId === 'tenant-a' && where.id === 'd1' ? row : null; },
      updateMany: async ({ where, data }: any) => { calls.push({ where, data });
        if (row.status !== 'PENDING' || where.userId !== 'tenant-a' || where.updatedAt !== row.updatedAt || where.trace.is !== null) return { count: 0 };
        Object.assign(row, data); return { count: 1 }; },
    },
  };
  assert.equal((await markStalledDecisionForReview({ userId: 'tenant-a', decisionId: 'd1', now }, db)).status, 'MARKED_UNCERTAIN');
  assert.equal(row.status, 'NEEDS_REVIEW');
  assert.ok(row.reviewReasons.includes(UNCERTAIN_ANALYSIS_REASON));
  assert.equal((await markStalledDecisionForReview({ userId: 'tenant-a', decisionId: 'd1', now }, db)).status, 'NOT_PENDING');
  assert.equal(calls.filter(call => call.where).length, 1);
  assert.equal(calls[1].where.userId, 'tenant-a');
  assert.equal(calls[1].data.status, 'NEEDS_REVIEW');
  assert.equal(calls[1].data.recommendedNextAction, 'REVIEW_MANUALLY');
  assert.equal(calls[1].where.trace.is, null);
  assert.equal(readFileSync(join(process.cwd(), 'src/lib/decision/pending-recovery.ts'), 'utf8').includes('provider.analyze'), false);
});

test('stalled recovery refuses recent and cross-tenant Decision records', async () => {
  const now = new Date('2026-10-20T10:00:00.000Z');
  let updates = 0;
  const row: any = { id: 'd2', status: 'PENDING', createdAt: now, updatedAt: now, reviewReasons: [], trace: null };
  const db: any = { decision: { findFirst: async ({ where }: any) => where.userId === 'tenant-a' ? row : null,
    updateMany: async () => { updates++; return { count: 1 }; } } };
  assert.equal((await markStalledDecisionForReview({ userId: 'tenant-a', decisionId: 'd2', now }, db)).status, 'TOO_RECENT');
  assert.equal((await markStalledDecisionForReview({ userId: 'tenant-b', decisionId: 'd2', now }, db)).status, 'NOT_FOUND');
  assert.equal(updates, 0);
});

test('Micro tier inbound scheduling persists normally but skips Decision Engine work', async () => {
  const original = process.env.DECISION_ENGINE_ROLLOUT_MODE;
  process.env.DECISION_ENGINE_ROLLOUT_MODE = 'SHADOW_AUTO';
  try {
    let callback: (() => Promise<void>) | null = null;
    let aiCalls = 0;
    scheduleInboundDecisions('tenant-a', ['signal-micro'], { enqueue: (task: any) => { callback = task; },
      tier: async () => 'MICRO_PILOT', triage: (async () => { aiCalls++; }) as any });
    assert.ok(callback);
    await (callback as () => Promise<void>)();
    assert.equal(aiCalls, 0);
  } finally {
    if (original === undefined) delete process.env.DECISION_ENGINE_ROLLOUT_MODE;
    else process.env.DECISION_ENGINE_ROLLOUT_MODE = original;
  }
});

test('automatic scheduling and triage failures cannot reject an already persisted inbound event', async () => {
  const original = process.env.DECISION_ENGINE_ROLLOUT_MODE;
  process.env.DECISION_ENGINE_ROLLOUT_MODE = 'SHADOW_AUTO';
  try {
    let inboundSaved = true;
    assert.doesNotThrow(() => scheduleInboundDecisions('tenant-a', ['signal-1'], {
      enqueue: (() => { throw new Error('after unavailable'); }) as any,
    }));
    let callback: (() => Promise<void>) | null = null;
    scheduleInboundDecisions('tenant-a', ['signal-1'], { enqueue: ((task: any) => { callback = task; }) as any,
      tier: async () => 'CORE', triage: (async () => { throw new Error('provider failed'); }) as any });
    assert.ok(callback);
    await (callback as () => Promise<void>)();
    assert.equal(inboundSaved, true);
  } finally {
    if (original === undefined) delete process.env.DECISION_ENGINE_ROLLOUT_MODE;
    else process.env.DECISION_ENGINE_ROLLOUT_MODE = original;
  }
});

test('manual Analyze remains available in MANUAL mode and uses the existing idempotent service', async () => {
  assert.equal(canManuallyAnalyze('MANUAL'), true);
  const f = fixture();
  await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps);
  await triageInboundSignal({ userId: f.tenant, signalId: 'signal-1' }, f.deps);
  assert.equal(f.calls(), 1);
  assert.equal(f.usage.length, 1);
});


test('same Decision provider result carries distinct evidence-grounded buying interest', async () => {
  const validated = validateTriageOutput({ ...answer, prospectInterestScore: 78 }, 'What is the price?');
  assert.equal(validated.prospectInterestScore, 78);
  assert.equal(validated.overallConfidence, 84);
  assert.equal(validateTriageOutput({ ...answer, prospectInterestScore: null }, 'What is the price?').prospectInterestScore, null);
  assert.throws(() => validateTriageOutput({ ...answer, prospectInterestScore: 101 }, 'What is the price?'), /interest score/);
  assert.throws(() => validateTriageOutput({ ...answer, prospectInterestScore: '90' }, 'What is the price?'), /interest score/);
  assert.match(TRIAGE_SYSTEM_PROMPT, /NOT confidence or likelihood of closing/);
  assert.ok((TRIAGE_RESPONSE_SCHEMA as { required?: string[] }).required?.includes('prospectInterestScore'));
  const f=fixture({answer: { ...answer, prospectInterestScore: 78 }});
  const result=await triageInboundSignal({userId:'tenant-a',signalId:'signal-1'},f.deps);
  assert.equal((result.decision?.trace?.intentOutput as {prospectInterestScore?:number})?.prospectInterestScore,78);
  assert.equal(result.decision?.confidenceScore,84);
  assert.equal(f.calls(),1,'no extra provider call');
});
