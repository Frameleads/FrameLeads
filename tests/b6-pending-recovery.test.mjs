import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const TENANT='cmsz65snq00016585j70is9qj',SIGNAL='f819e17e-afff-4995-8754-9a5dc0897414',DECISION='cmuyn5uii001y12uq4lk5oebf';
const input={mode:'RECOVER_PENDING_DECISION',signalId:SIGNAL,decisionId:DECISION};
function fixture(patch={}){
 let calls=0,usageCount=2,traces=0;
 const decision={id:DECISION,userId:TENANT,status:'PENDING',trace:null,source:'UNAVAILABLE',shadowMode:true,supersedesDecisionId:null,decisionType:'INBOUND_TRIAGE',
  prospectId:'owned',conversationId:'conversation',inputMessageId:'message',contextFingerprint:'fingerprint',
  inputMessage:{id:'message',userId:TENANT,prospectId:'owned',conversationId:'conversation',sourceType:'INBOUND_SIGNAL',sourceId:SIGNAL,direction:'INBOUND'},...patch};
 const db={decision:{findFirst:async()=>decision,count:async()=>1,create:()=>{throw Error('No new Decision allowed');}},
  inboundSignal:{findFirst:async()=>({id:SIGNAL,userId:TENANT,prospectId:'owned'})},
  salesConstitution:{findUnique:async()=>({revision:1})},decisionExecutionAttempt:{count:async()=>0},aIUsageEvent:{count:async()=>usageCount,findFirst:async()=>({status:'SUCCESS',provider:'ANTHROPIC'})},
  prospect:{findFirst:async()=>({id:'owned'})},generatedLead:{findFirst:async()=>({id:'lead'})},conversation:{findFirst:async()=>({id:'conversation'})},
  $queryRaw:async()=>[{id:TENANT}],$transaction:async work=>work(db)};
 const modules={'../prisma':{prisma:db},'./provider':{selectTriageProvider:()=>({provider:'ANTHROPIC'})},'./b6-anthropic-smoke':{B6_CLAUDE_SMOKE:'B6_ANTHROPIC_SYNTHETIC_SMOKE'},'./activation-preview':{realPreviewReply:()=>true},
  './b6-controlled-acceptance':{B6_CUSTOMER:'akramwalid628@gmail.com',B6_PROSPECT:'akram@frameleads.io',readAcceptancePreflight:async()=>({userId:TENANT,policyReady:true,analysisEnabled:true,decisionCount:1})},
  './b6-persisted-signal':{B6_SIGNAL:SIGNAL},'./context':{buildReplyDecisionContext:async()=>({contextFingerprint:'fingerprint',constitution:{revision:1}})},
  '../customer-lifecycle':{qualifiesGovernedDecision:()=>true},
  './triage':{analyzeAndFinalizeReservedTriage:async(args,deps)=>{assert.equal(args.pending.id,DECISION);assert.equal(args.strictRecovery,true);calls++;usageCount++;
   if(deps.providerFailure)return {status:'STOPPED',failureClass:'PROVIDER_4XX'};
   decision.status='READY';decision.source='ANTHROPIC';decision.provider='ANTHROPIC';decision.trace={id:'trace',constitutionRevision:1,policyResult:[{revision:1}]};traces++;return {status:'READY',decision};}}
 };
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/decision/b6-pending-recovery.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{assert.ok(modules[name],`Unexpected dependency ${name}`);return modules[name];}});
 const lifecycle=async()=>({status:'VERIFIED',onboarding:{id:'onboarding',product_user_id:TENANT,purchased_offer:'MICRO_PILOT',
  state:decision.status==='PENDING'?'READY_FOR_DECISION':'ACTIVATED',activated_at:decision.status==='PENDING'?null:'now',first_governed_decision_id:decision.status==='PENDING'?null:DECISION}});
 return {api:exports,db,decision,lifecycle,calls:()=>calls,traces:()=>traces};
}
test('fixed recovery rejects other Decision/Signal IDs and extra inputs before any operation',async()=>{
 const f=fixture();for(const value of [{...input,decisionId:'other'},{...input,signalId:'other'},{...input,extra:true}])await assert.rejects(f.api.recoverPendingDecision(value,{},f.lifecycle));assert.equal(f.calls(),0);
});
test('recovery refuses non-PENDING, existing trace, ownership mismatch or extra prior attempt',async()=>{
 for(const patch of [{status:'READY'},{trace:{id:'existing'}},{prospectId:'other'}]){const f=fixture(patch);await assert.rejects(f.api.recoverPendingDecision(input,{},f.lifecycle));assert.equal(f.calls(),0);}
 const f=fixture();f.db.decisionExecutionAttempt.count=async()=>1;await assert.rejects(f.api.recoverPendingDecision(input,{},f.lifecycle));assert.equal(f.calls(),0);
});
test('same reserved Decision is finalized once, no second reservation, trace or provider send',async()=>{
 const f=fixture();const result=await f.api.recoverPendingDecision(input,{},f.lifecycle);assert.equal(result.status,'ACTIVATED');assert.equal(result.decisionId,DECISION);
 assert.equal(f.calls(),1);assert.equal(f.traces(),1);assert.equal(result.emailsSent,0);await assert.rejects(f.api.recoverPendingDecision(input,{},f.lifecycle));assert.equal(f.calls(),1);
});
test('provider failure leaves same PENDING row, no trace, no new Decision and no automatic/replayed call',async()=>{
 const f=fixture();const result=await f.api.recoverPendingDecision(input,{providerFailure:true},f.lifecycle);assert.equal(result.code,'PROVIDER_4XX');assert.equal(f.decision.status,'PENDING');assert.equal(f.traces(),0);assert.equal(f.calls(),1);
 await assert.rejects(f.api.recoverPendingDecision(input,{},f.lifecycle));assert.equal(f.calls(),1);
});
test('wrong Constitution revision or altered context fails before provider',async()=>{
 const f=fixture();f.db.salesConstitution.findUnique=async()=>({revision:2});await assert.rejects(f.api.recoverPendingDecision(input,{},f.lifecycle));assert.equal(f.calls(),0);
});
test('failed or missing synthetic Claude smoke cannot rearm real recovery',async()=>{
 const f=fixture();f.db.aIUsageEvent.findFirst=async()=>null;await assert.rejects(f.api.recoverPendingDecision(input,{},f.lifecycle));assert.equal(f.calls(),0);
});
