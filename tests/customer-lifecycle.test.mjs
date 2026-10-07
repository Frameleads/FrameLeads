import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
const source=fs.readFileSync(new URL('../src/lib/customer-lifecycle.ts',import.meta.url),'utf8');
const exports={},env={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,require:n=>{if(n==='node:crypto')return crypto;if(n==='./prisma')return {prisma:{}};if(n==='@vercel/oidc')return {getVercelOidcToken:async()=>{throw Error('No live identity allowed');}};throw Error('Forbidden '+n);},process:{env},fetch:()=>{throw Error('No provider allowed');},URL,Date,TextDecoder,console});
const d={id:'canonical-decision',userId:'tenant',prospectId:'prospect',inputMessageId:'message',contextFingerprint:'fp',status:'READY',source:'GEMINI',reviewReasons:[],
 trace:{id:'trace',userId:'tenant',decisionId:'canonical-decision',inputMessageId:'message',contextFingerprint:'fp',createdAt:new Date(),policyResult:[{authority:'SALES_CONSTITUTION',revision:1,configurationMissing:false,decision:'ALLOWED',effectiveEffect:null}]},
 inputMessage:{userId:'tenant',direction:'INBOUND',sourceType:'INBOUND_SIGNAL',sourceId:'signal'}};
const signal={id:'signal',userId:'tenant',prospectId:'prospect',sourceType:'IMAP_NATIVE',sourceMessageId:'<actual-provider-message@customer.io>'};
test('canonical policy-governed decision qualifies without sending',()=>{assert.equal(exports.qualifiesGovernedDecision(d,signal),true);});
test('demo, simulation, unconfigured, failed and cross-tenant records never activate',()=>{
 for(const invalid of [{...d,trace:null},{...d,status:'PENDING'},{...d,source:'UNAVAILABLE'},{...d,trace:{...d.trace,contextFingerprint:'other'}},
  {...d,reviewReasons:['PROVIDER_UNAVAILABLE']},{...d,trace:{...d.trace,policyResult:[{configurationMissing:true}]}},
  {...d,inputMessage:{...d.inputMessage,userId:'other'}}])assert.equal(exports.qualifiesGovernedDecision(invalid,signal),false);
 for(const invalid of [{...signal,sourceType:'MANUAL'},{...signal,sourceType:'DEMO'},{...signal,sourceMessageId:'test_fixture'},{...signal,userId:'other'},{...signal,sourceMessageId:null}])assert.equal(exports.qualifiesGovernedDecision(d,invalid),false);
});
test('product query returns only safe durable identifiers, stable event IDs and exact tenant',async()=>{
 const created=new Date('2026-10-07T16:00:00Z');let tenantQueries=0;
 const db={user:{findMany:async()=>[{id:'tenant',email:'owner@example.com',whopId:'whop-owned',tier:'CORE',createdAt:created}]},
  prospect:{findFirst:async q=>{assert.equal(q.where.userId,'tenant');tenantQueries++;return {id:'prospect',createdAt:created};}},
  inboundSignal:{findFirst:async q=>{assert.equal(q.where.userId,'tenant');tenantQueries++;return q.where.id?signal:{id:'signal',createdAt:created};}},
  decision:{findMany:async q=>{assert.equal(q.where.userId,'tenant');assert.equal(q.take,50);tenantQueries++;return [{...d,trace:{...d.trace,createdAt:created}}];}}};
 const a=await exports.readCustomerMilestones('owner@example.com',created,db),b=await exports.readCustomerMilestones('owner@example.com',created,db);
 assert.equal(a.milestones.length,4);assert.equal(a.milestones[3].milestone,'FIRST_GOVERNED_DECISION');assert.equal(a.milestones[3].evidenceId,'trace');
 assert.equal(JSON.stringify(a),JSON.stringify(b));assert.ok(tenantQueries>=4);assert.equal(JSON.stringify(a).includes('rawEmail'),false);
});
test('missing product user remains unactivated and ambiguous identity fails closed',async()=>{
 assert.equal((await exports.readCustomerMilestones('owner@example.com',new Date(),{user:{findMany:async()=>[]}})).status,'PRODUCT_ACCOUNT_REQUIRED');
 await assert.rejects(exports.readCustomerMilestones('owner@example.com',new Date(),{user:{findMany:async()=>[{},{}]}}));
});
test('unsigned browser cannot authorize evidence; absent bridge makes no network request',async()=>{
 assert.equal(exports.lifecycleAuthorized(new Request('https://product.test')),false);
 env.CUSTOMER_LIFECYCLE_BRIDGE_SECRET='local_test_only'.repeat(4);
 assert.equal(exports.lifecycleAuthorized(new Request('https://product.test',{headers:{authorization:'Bearer '+env.CUSTOMER_LIFECYCLE_BRIDGE_SECRET}})),true);
 assert.equal((await exports.syncCustomerLifecycle('owner@example.com')).status,'BRIDGE_NOT_CONFIGURED');
});
test('streaming request boundary rejects oversized data before parsing',async()=>{
 assert.equal(await exports.boundedLifecycleBody(new Request('https://product.test',{method:'POST',body:'{}'})),'{}');
 await assert.rejects(exports.boundedLifecycleBody(new Request('https://product.test',{method:'POST',body:'x'.repeat(1025)})),/BODY_TOO_LARGE/);
});
