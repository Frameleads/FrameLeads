import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const load=(file,require,extra={})=>{const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,process:{env:{}},Date,...extra});return exports;};
const blocked=()=>{throw Error('No production operation allowed');};
const harness=load('../src/lib/decision/b6-controlled-acceptance.ts',name=>name==='./rollout'?{canManuallyAnalyze:()=>true}:new Proxy({},{get:()=>blocked}));
const input={B6_ACCEPTANCE_RUN:'true',B6_ACCEPTANCE_CUSTOMER_EMAIL:'akramwalid628@gmail.com',B6_CONTROLLED_PROSPECT_EMAIL:'akram@frameleads.io',B6_REPLY_MESSAGE_ID:'<isolated@provider.test>',B6_GMAIL_APP_PASSWORD:'isolatedpassword'};
test('operator guard and fixed identities reject before any provider/model/database operation and clear password',async()=>{
 for(const changes of [{B6_ACCEPTANCE_RUN:undefined},{B6_ACCEPTANCE_RUN:'TRUE'},{B6_ACCEPTANCE_CUSTOMER_EMAIL:'other@example.com'},{B6_CONTROLLED_PROSPECT_EMAIL:'other@example.com'},{B6_REPLY_MESSAGE_ID:'invalid'}]){
  const value={...input,...changes};await assert.rejects(harness.runControlledAcceptance(value));assert.equal(value.B6_GMAIL_APP_PASSWORD,'');
 }
});
test('read-only preflight reports real policy and durable allowance without altering either',async()=>{
 let reads=0;const db={user:{findMany:async()=>[{id:'tenant',tier:'MICRO_PILOT',whopId:'whop_real'}]},salesConstitution:{findUnique:async()=>{reads++;return {revision:2};}},decision:{count:async()=>1}};
 const result=await harness.readAcceptancePreflight(db);assert.equal(result.policyReady,true);assert.equal(result.decisionCount,1);assert.equal(reads,1);
 db.salesConstitution.findUnique=async()=>null;assert.equal((await harness.readAcceptancePreflight(db)).policyReady,false);
 db.user.findMany=async()=>[{tier:'CORE',whopId:'whop_real'}];await assert.rejects(harness.readAcceptancePreflight(db));
});
test('Gmail read verifies Inbox and Sent read-only, real parent and post-purchase timestamps; no credential storage',async()=>{
 const calls=[],now=new Date(),password='isolatedpassword';
 class Client{
  constructor(options){assert.equal(options.host,'imap.gmail.com');assert.equal(options.secure,true);assert.equal(options.logger,false);assert.equal(options.auth.pass,password);}
  async connect(){}async logout(){}close(){}
  async getMailboxLock(folder,options){calls.push([folder,options.readOnly]);return {release(){}};}
  async search(){return [1];}async list(){return [{specialUse:'\\Sent',path:'Sent'}];}
  async fetchOne(id,options){if(options.size)return {size:100,internalDate:now};if(options.source)return {source:Buffer.from('provider-only')};return {internalDate:now,envelope:{messageId:'<parent@provider.test>',from:[{address:input.B6_ACCEPTANCE_CUSTOMER_EMAIL}],to:[{address:input.B6_CONTROLLED_PROSPECT_EMAIL}]}};}
 }
 const gmail=load('../src/lib/decision/activation-preview-gmail.ts',name=>name==='imapflow'?{ImapFlow:Client}:name==='mailparser'?{simpleParser:async()=>({messageId:input.B6_REPLY_MESSAGE_ID,inReplyTo:'<parent@provider.test>',from:{value:[{address:input.B6_CONTROLLED_PROSPECT_EMAIL}]},to:{value:[{address:input.B6_ACCEPTANCE_CUSTOMER_EMAIL}]},text:'Real bounded buyer question',headers:new Map()})}:{validatePreviewReceipt:(reply,mailbox,prospect,since)=>{assert.equal(reply.from,prospect);assert.ok(reply.to.includes(mailbox));assert.ok(reply.receivedAt>=since);}}, {Buffer});
 const value={mailbox:input.B6_ACCEPTANCE_CUSTOMER_EMAIL,prospectEmail:input.B6_CONTROLLED_PROSPECT_EMAIL,messageId:input.B6_REPLY_MESSAGE_ID,appPassword:password,since:new Date(now.getTime()-1000)};
 assert.equal((await gmail.readPreviewGmailReply(value)).inReplyTo,'<parent@provider.test>');assert.equal(value.appPassword,'');assert.deepEqual(calls,[['INBOX',true],['Sent',true]]);
 value.appPassword=password;value.since=new Date(now.getTime()+10000);await assert.rejects(gmail.readPreviewGmailReply(value));assert.equal(value.appPassword,'');
});
test('Onboarding contains no acceptance card, credentials or replacement controls; browser setup routes removed',()=>{
 const page=fs.readFileSync(new URL('../src/app/dashboard/onboarding/page.tsx',import.meta.url),'utf8');assert.equal(/ActivationProgress|B6_GMAIL|Reply Message-ID|Check saved progress|Refresh status|Capture one real reply/.test(page),false);
 for(const file of ['src/app/dashboard/onboarding/ActivationProgress.tsx','src/app/api/onboarding/activation-preview/route.ts','src/app/api/onboarding/activation-preview/prospect/route.ts','src/app/api/onboarding/activation-preview/reply/route.ts'])assert.equal(fs.existsSync(new URL('../'+file,import.meta.url)),false);
});
