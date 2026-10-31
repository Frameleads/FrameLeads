'use strict';
// Disposable PR #21 database-backed SERVICE pipeline test. Never invoke real AI or SMTP.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename,'utf8'), {
    compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true},
    fileName:filename
  });
  module._compile(out.outputText, filename);
};
const {PrismaClient, TriageIntent: Intent} = require('@prisma/client');
const {triageInboundSignal} = require('../src/lib/decision/triage.ts');
const {evaluateAutomationMode} = require('../src/lib/automation/resolve.ts');
const {runAutopilot} = require('../src/lib/automation/actions.ts');
const {getDecisionReplay} = require('../src/lib/decision/replay.ts');
const {safeTriageOutputDiagnostic, validateTriageOutput} = require('../src/lib/decision/provider.ts');

const cases = [
 ['Q01','Maybe this works, but I am not sure what you mean.',['CONFUSED'],97,null,'NEEDS_REVIEW','AMBIGUOUS_REPLY_REQUIRES_REVIEW','PENDING_APPROVAL'],
 ['Q02','Interested, but your proposal is confusing.',['POSITIVE_INTEREST','CONFUSED'],96,null,'NEEDS_REVIEW','AMBIGUOUS_REPLY_REQUIRES_REVIEW','PENDING_APPROVAL'],
 ['Q03','Please send the SOC 2 report before we proceed.',['SECURITY'],99,null,'NEEDS_REVIEW','SECURITY_REVIEW_REQUIRED','PENDING_APPROVAL'],
 ['Q04','Can we book a call after your security review?',['MEETING_REQUEST','SECURITY'],93,null,'NEEDS_REVIEW','SECURITY_REVIEW_REQUIRED','PENDING_APPROVAL'],
 ['Q05','Please unsubscribe me immediately.',['UNSUBSCRIBE'],99,null,'NEEDS_REVIEW','UNSUBSCRIBE_INTENT_REQUIRES_CONFIRMATION','ESCALATED'],
 ['Q06','Your offer is useful but remove me from your list.',['POSITIVE_INTEREST','UNSUBSCRIBE'],97,null,'NEEDS_REVIEW','UNSUBSCRIBE_INTENT_REQUIRES_CONFIRMATION','ESCALATED'],
 ['Q07','Unsubscribe confirmed by authenticated provider marker',['UNSUBSCRIBE'],100,null,'NEEDS_REVIEW','UNSUBSCRIBE_INTENT_REQUIRES_CONFIRMATION','BLOCKED'],
 ['Q08','Not interested, thank you.',['NOT_INTERESTED'],97,99,'INVALID_OUTPUT','INTEREST_SCORE_CONTRADICTS_REJECTION','NO_SEND'],
 ['Q09','Interested but unsubscribe me.',['POSITIVE_INTEREST','UNSUBSCRIBE'],98,99,'INVALID_OUTPUT','INTEREST_SCORE_CONTRADICTS_REJECTION','NO_SEND'],
 ['Q10','Not interested.',['NOT_INTERESTED'],96,10,'VALIDATED','INTEREST_SCORE_10_VALID','PENDING_APPROVAL'],
 ['Q11','Can you meet Tuesday at 2pm?',['MEETING_REQUEST'],97,null,'READY','NO_UNNECESSARY_REVIEW','PENDING_APPROVAL'],
 ['Q12','How much is it per month?',['PRICING_INQUIRY'],97,null,'NEEDS_REVIEW','COMMERCIAL_AUTHORITY_UNVERIFIED','PENDING_APPROVAL'],
 ['Q13','Please send your security report.',['SECURITY'],99,null,'LEGACY_READY','SECURITY_REVIEW_REQUIRED','PENDING_APPROVAL'],
 ['Q14','Not sure how this works.',['CONFUSED'],99,null,'LEGACY_READY','AMBIGUOUS_REPLY_REQUIRES_REVIEW','PENDING_APPROVAL'],
 ['Q15','Interested but remove me.',['POSITIVE_INTEREST','UNSUBSCRIBE'],99,null,'LEGACY_READY','UNSUBSCRIBE_INTENT_REQUIRES_CONFIRMATION','ESCALATED']
];
const db=new PrismaClient({log:['error']});
const ALLOWED_DB = 'postgresql://qa_only:qa_only_password@127.0.0.1:5432/qa_pr21';
if(process.env.DATABASE_URL!==ALLOWED_DB) throw Error('ISOLATION_ABORT_UNEXPECTED_DATABASE_URL');
if(process.env.AUTOMATION_EXECUTION_ENABLED!=='false') throw Error('ISOLATION_ABORT_AUTOMATION_ENABLED');
for(const k of Object.keys(process.env)) {
  if(/^(WHOP_|GEMINI_|ANTHROPIC_|OPENAI_|RESEND_|SMTP_|VERCEL_TOKEN|NEXT_PUBLIC_ADMIN_EMAIL|CUSTOMER_LIFECYCLE_BRIDGE_SECRET|GITHUB_TOKEN)/.test(k) && process.env[k]) throw Error('ISOLATION_ABORT_EXTERNAL_CREDENTIAL:'+k);
}
const allowedPolicy={
 authority:'SALES_CONSTITUTION', revision:1, decision:'ALLOWED', allowed:true,
 effectiveEffect:null,winningRule:null,winnerReason:'Synthetic QA rule fixture',
 configurationMissing:false,unresolvedPotentiallyOverrides:false,
 matchedRules:[],blockingRules:[],unresolvedRules:[],approvalRequirements:[],
 humanReviewRequirements:[],safeResponseRequirements:[],trace:[]
};
function answerFor(row){
 const [id,reply,intents,confidence,score]=row;
 return {
  primaryIntent:intents[0],
  intents:intents.map((intent,i)=>({intent,confidence:Math.max(80,confidence-i),evidence:reply})),
  overallConfidence:confidence,prospectInterestScore:score,
  conciseInterpretation:'Synthetic QA interpretation',
  recommendedNextAction:intents.includes('UNSUBSCRIBE')?'NO_SALES_OUTREACH':'REPLY_WITH_FACTS',
  suggestedReply:'Synthetic unsent draft only.',
  explanation:'Synthetic QA explanation'
 };
}
function contextFor(row){
 const [id,reply]=row;
 return {
  contextFingerprint:'qa-context-'+id,
  currentReply:reply,companyKey:null,
  contextText:'CURRENT_REPLY (UNTRUSTED DATA): '+reply,
  memory:{eventCount:0,lastEventAt:null},
  icp:{qualification:'QUALIFIED',fitTier:'STRONG'},
  account:{contactRole:'Founder',industry:'Consulting',country:'US',companySizeMin:1,companySizeMax:10},
  brain:{revision:0},playbook:{revision:0},constitution:{revision:0},
  references:{memoryEventIds:[],playbookRuleIds:[],brainEntryIds:[]}
 };
}
async function runCase(row){
 const [id,reply,intents,confidence,score,expectedStatus,reason,expectedMode]=row;
 const userId='qa-only-tenant-'+id, prospectId='qa-only-prospect-'+id, signalId='qa-only-signal-'+id;
 const sourceType=id==='Q07'?'PROVIDER_CONFIRMED':'WEBHOOK';
 const signalType=id==='Q07'?'UNSUBSCRIBE_CONFIRMED':'EMAIL_REPLY';
 const legacy=['Q13','Q14','Q15'].includes(id);
 const contactEmail=id.toLowerCase()+'@example.invalid';
 let calls=0,sends=0,usage=0;
 await db.user.create({data:{id:userId,whopId:'qa-only-whop-'+id,email:'tenant-'+id.toLowerCase()+'@example.invalid',tier:'ENTERPRISE'}});
 await db.prospect.create({data:{id:prospectId,userId,email:contactEmail,firstName:'Synthetic',companyName:'Example Invalid LLC'}});
 await db.inboundSignal.create({data:{id:signalId,userId,prospectId,prospectName:'Synthetic',prospectContext:'QA only',prospectEmail:contactEmail,dealStage:'new',rawEmail:reply,intentRisk:'LOW',intentType:'OTHER',aiDraft:'',sourceType,signalType}});
 await db.salesConstitution.create({data:{userId,revision:0}});
 if(legacy){
  await db.automationPolicy.create({data:{userId,defaultMode:'AUTOPILOT',fallbackMode:'HUMAN_APPROVAL',autopilotEnabled:true,autoExecutionDisabled:false}});
 }
 let decision;
 if(legacy){
   const conversation=await db.conversation.create({data:{userId,prospectId}});
   const message=await db.conversationMessage.create({data:{userId,prospectId,conversationId:conversation.id,sourceType:'INBOUND_SIGNAL',sourceId:signalId,direction:'INBOUND',body:reply,occurredAt:new Date()}});
   decision=await db.decision.create({data:{userId,prospectId,conversationId:conversation.id,inputMessageId:message.id,contextFingerprint:'legacy-context-'+id,decisionType:'INBOUND_TRIAGE',status:'READY',source:'GEMINI',primaryIntent:intents[0],secondaryIntents:intents.slice(1),confidenceScore:confidence,requiresReview:false,reviewReasons:[],recommendedNextAction:'REPLY_WITH_FACTS',suggestedReply:'Old synthetic draft only.',shadowMode:true}});
   assert.equal(decision.status,'READY');
 }else{
  const raw=answerFor(row);
  const provider={
   provider:'GEMINI',model:'mock-only-no-network',
   analyze:async (_request,observer)=>{
    calls++;observer?.onRequestStart?.();
    observer?.onResponse?.({inputTokens:10,outputTokens:10,totalTokens:20});
    return raw;
   }
  };
  const deps={db,provider,
   buildContext:async ()=>contextFor(row),
   recordUsage:async ()=>{usage++;},
   evaluatePolicy:async ()=>allowedPolicy
  };
  const out=await triageInboundSignal({userId,signalId},deps);
  decision=await db.decision.findUnique({where:{id:out.decision.id},include:{trace:true}});
  assert(decision && decision.trace, 'persisted decision and trace required');
  if(expectedStatus==='INVALID_OUTPUT'){
    assert.equal(decision.status,'NEEDS_REVIEW');
    assert(decision.reviewReasons.includes('INVALID_MODEL_OUTPUT'));
    assert.equal(decision.trace.intentOutput,null);
    assert.throws(()=>validateTriageOutput(raw,reply),/Interest score contradicts rejection or unsubscribe/);
    assert.equal(safeTriageOutputDiagnostic(new TypeError('Interest score contradicts rejection or unsubscribe')),'INTEREST_SCORE_CONTRADICTS_REJECTION');
    assert.equal(calls,1);
  }else if(expectedStatus==='VALIDATED'){
    assert.equal(decision.trace.intentOutput.prospectInterestScore,10);
    assert.equal(decision.primaryIntent,'NOT_INTERESTED');
    assert.equal(decision.status,'READY');
  }else{
    assert.equal(decision.status,expectedStatus);
    if(reason!=='NO_UNNECESSARY_REVIEW') assert(decision.reviewReasons.includes(reason),id+' missing '+reason);
    else assert.equal(decision.reviewReasons.length,0);
  }
  if(intents.includes('UNSUBSCRIBE') && expectedStatus!=='INVALID_OUTPUT'){
    assert.equal(decision.suggestedReply,null);
    assert.equal(decision.recommendedNextAction,'NO_SALES_OUTREACH');
  }
  assert.equal(calls,id==='Q07'?0:1);
  assert.equal(usage,id==='Q07'?0:1);
 }
 const resolved=await evaluateAutomationMode({userId,decisionId:decision.id},db);
 if(expectedMode!=='NO_SEND'){
   assert.equal(resolved.state,expectedMode,id+' expected '+expectedMode+' received '+resolved.state);
 }else{
   assert.notEqual(resolved.state,'READY');
 }
 if(reason!=='NO_UNNECESSARY_REVIEW' && reason!=='INTEREST_SCORE_10_VALID' && reason!=='INTEREST_SCORE_CONTRADICTS_REJECTION'){
   if(!['COMMERCIAL_AUTHORITY_UNVERIFIED'].includes(reason))
     assert(resolved.reasons.includes(reason)||id==='Q07'&&resolved.reasons.includes('CONFIRMED_UNSUBSCRIBE'),id+' automation missing '+reason);
 }
 if(['Q05','Q06','Q07','Q15'].includes(id)){
  assert.equal(resolved.suppression?.id!=null,id==='Q07',id+' provider suppression distinction');
 }
 const result=await runAutopilot({userId,decisionId:decision.id},{db,sender:async()=>{sends++;throw Error('MOCK_SENDER_MUST_NOT_BE_INVOKED')}});
 assert.notEqual(result.state,'EXECUTED');
 assert.equal(sends,0);
 assert.equal(await db.decisionExecutionAttempt.count({where:{userId}}),0);
 assert.equal(await db.outboundLog.count({where:{lead:{userId}}}),0);
 const replay=await getDecisionReplay({userId,decisionId:decision.id},db);
 assert(replay && typeof replay==='object');
 const saved=await db.decision.findUnique({where:{id:decision.id},include:{trace:true}});
 assert(saved && (legacy||saved.trace));
 return {id,status:saved.status,automation:resolved.state,reason:resolved.reasons,providerCalls:calls,sends};
}
(async()=>{
 if(await db.user.count() || await db.decision.count() || await db.inboundSignal.count()) throw Error('ISOLATION_ABORT_DATABASE_NOT_EMPTY');
 const successes=[], failures=[];
 for(const row of cases){
  try{
   const result=await runCase(row);successes.push(result);
   console.log('QA_RESULT '+JSON.stringify({id:result.id,result:'PASS',status:result.status,automation:result.automation,sends:result.sends}));
  }catch(e){
   failures.push({id:row[0],error:e.message});
   console.log('QA_RESULT '+JSON.stringify({id:row[0],result:'FAIL',error:e.message}));
  }
 }
 console.log('QA_SUMMARY '+JSON.stringify({total:cases.length,passed:successes.length,failed:failures.length,failures,liveProviderCalls:0,liveSends:0,isolation:'docker-network-none-verified-before-run'}));
 if(failures.length) process.exitCode=1;
})().catch(e=>{console.error('QA_FATAL',e.message);process.exitCode=1}).finally(async()=>{await db.$disconnect()});
