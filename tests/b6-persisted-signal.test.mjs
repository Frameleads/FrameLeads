import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/lib/decision/b6-persisted-signal.ts',import.meta.url),'utf8');
function fixture({badEvidence=false,existing=0,contextFailure=false,triageFailure=false}={}){
 let calls=0,syncs=0,count=existing;
 const signal={id:'f819e17e-afff-4995-8754-9a5dc0897414',userId:'tenant',prospectId:'owned'};
 const linked={message:{id:'message'},conversation:{id:'conversation'}};
 const db={inboundSignal:{findFirst:async q=>{assert.equal(q.where.id,signal.id);assert.equal(q.where.userId,'tenant');return signal;}},
 generatedLead:{findFirst:async q=>{assert.equal(q.where.userId,'tenant');assert.equal(q.where.email,'akram@frameleads.io');return {id:'lead'};}},
 prospect:{findFirst:async q=>{assert.equal(q.where.normalizedEmail,'akram@frameleads.io');return {id:'owned'};}},
 decision:{findMany:async()=>[],count:async()=>count,findFirst:async()=>({id:'decision',trace:{id:'trace'}})},decisionExecutionAttempt:{count:async()=>0}};
 const context=async()=>{if(contextFailure)throw Object.assign(Error('SECRET-DO-NOT-RETURN'),{name:'PrismaClientValidationError'});return {};};
 const modules={
 '../prisma':{prisma:db},'./conversation':{getInboundConversationMessage:async()=>linked},'./activation-preview':{realPreviewReply:()=>!badEvidence},
 '../prospects/memory':{getProspectMemoryContext:context},'../brain':{getBrainContext:async()=>({})},
 '../revenue-playbook':{getPlaybookContext:async()=>({})},'../sales-constitution':{getSalesConstitutionContext:async()=>({})},
 './context':{buildReplyDecisionContext:context},'./b6-controlled-acceptance':{B6_CUSTOMER:'akramwalid628@gmail.com',B6_PROSPECT:'akram@frameleads.io',
 readAcceptancePreflight:async()=>({userId:'tenant',policyReady:true,analysisEnabled:true,decisionCount:count})},
 './triage':{triageInboundSignal:async input=>{calls++;assert.equal(input.signalId,signal.id);assert.equal(input.activationPreview,true);if(triageFailure)throw Error('secret');count=1;}},
 '../customer-lifecycle':{qualifiesGovernedDecision:()=>true,syncCustomerLifecycle:async()=>{syncs++;return {status:'VERIFIED',onboarding:{id:'onboarding',product_user_id:'tenant',purchased_offer:'MICRO_PILOT',state:count?'ACTIVATED':'ONBOARDING_STARTED',activated_at:count?'now':null,first_governed_decision_id:count?'decision':null}};}}
 };
 const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,require:name=>{assert.ok(modules[name],`Unexpected dependency ${name}`);return modules[name];},console:{error(){}}});
 return {api:exports,calls:()=>calls,syncs:()=>syncs};
}
test('diagnostic checks all eleven stages without reserving or executing a Decision',async()=>{
 const f=fixture();const result=await f.api.diagnosePersistedSignal();assert.equal(result.status,'DIAGNOSTIC_READY');assert.equal(result.stages.length,11);assert.equal(f.calls(),0);assert.equal(f.syncs(),0);
});
test('context failure reports bounded stage/class without raw error, then blocks resume',async()=>{
 const f=fixture({contextFailure:true});const result=await f.api.diagnosePersistedSignal();assert.equal(result.status,'DIAGNOSTIC_BLOCKED');
 assert.equal(result.stages.find(s=>s.stage==='PROSPECT_MEMORY_CONTEXT').errorClass,'PrismaClientValidationError');assert.equal(JSON.stringify(result).includes('SECRET'),false);
 await assert.rejects(f.api.resumePersistedSignal(),/PERSISTED_SIGNAL_PREFLIGHT_FAILED/);assert.equal(f.calls(),0);
});
test('persisted resume validates real evidence and unused allowance before canonical execution',async()=>{
 for(const options of [{badEvidence:true},{existing:1}]){const f=fixture(options);await assert.rejects(f.api.resumePersistedSignal());assert.equal(f.calls(),0);}
});
test('resume reuses one fixed signal, executes once, verifies trace and repeats canonical projection',async()=>{
 const f=fixture();const result=await f.api.resumePersistedSignal();assert.equal(result.status,'ACTIVATED');assert.equal(f.calls(),1);assert.equal(f.syncs(),3);assert.equal(result.emailsSent,0);
 await assert.rejects(f.api.resumePersistedSignal());assert.equal(f.calls(),1);
});
test('canonical failure is not retried and exception data cannot escape',async()=>{
 const f=fixture({triageFailure:true});await assert.rejects(f.api.resumePersistedSignal(),e=>e.message==='GOVERNED_DECISION_FAILED');assert.equal(f.calls(),1);
 const safe=f.api.safeDiagnosticError({name:'PrivateSecret',message:'secret',code:'secret',meta:{modelName:'secret'}});assert.equal(JSON.stringify(safe).includes('secret'),false);
});
