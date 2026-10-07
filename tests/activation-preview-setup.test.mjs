import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/decision/activation-preview-setup.ts',import.meta.url),'utf8'),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,Date,require:n=>{
  if(n==='node:crypto')return crypto;
  if(n==='../prisma')return {prisma:{}};
  if(n==='../prospects/identity')return {
   identityTransaction:async(db,work)=>{let release;const prior=db.queue;db.queue=new Promise(r=>release=r);await prior;try{return await work(db);}finally{release();}},
   resolveProspectInTransaction:async(_tx,input)=>({prospectId:'prospect:'+input.email})};
  if(n==='../prospects/memory')return {MEMORY_EVENT:{LEAD_LINKED:'LEAD_LINKED',INBOUND_RECEIVED:'INBOUND_RECEIVED'},recordProspectMemoryEventInTransaction:async(tx,e)=>tx.memory.push(e)};
  if(n==='./conversation')return {materializeInboundSignalInTransaction:async(tx,s)=>tx.messages.push(s.id)};
  throw Error('Forbidden dependency '+n);
 }});
function fixture(){
 const leads=[],signals=[],memory=[],messages=[],user={tier:'MICRO_PILOT',email:'owner@gmail.com',monthlyQuota:25,leadsProcessed:0};
 const db={queue:Promise.resolve(),memory,messages,
  $queryRaw:async(_sql,id)=>{assert.equal(id,'tenant');return [user];},
  decision:{findFirst:async()=>null},user:{update:async()=>user.leadsProcessed++},
  generatedLead:{findFirst:async({where})=>leads.find(l=>l.userId===where.userId && (!where.id||l.id===where.id) && (!where.prospectId||l.prospectId===where.prospectId)),
   create:async({data})=>{const lead={id:'lead:'+leads.length,...data};leads.push(lead);return lead;}},
  inboundSignal:{findFirst:async({where})=>signals.find(s=>s.userId===where.userId && (!where.sourceMessageId||s.sourceMessageId===where.sourceMessageId) && (!where.signalAnalysis||s.signalAnalysis===where.signalAnalysis)),
   create:async({data})=>{const signal={id:'signal:'+signals.length,...data};signals.push(signal);return signal;}}};
 return {db,leads,signals,user,memory,messages};
}
const reply={messageId:'<actual-reply@provider.example>',inReplyTo:'<actual-sent@provider.example>',from:'controlled@example.com',to:['owner@gmail.com'],text:'How does approval work?',receivedAt:new Date()};
test('concurrent controlled import creates one canonical lead and consumes one quota slot without generating drafts',async()=>{
 const f=fixture();const [a,b]=await Promise.all([exports.importPreviewProspect('tenant',' Controlled@example.com '.trim(),f.db),exports.importPreviewProspect('tenant','controlled@example.com',f.db)]);
 assert.equal(a.id,b.id);assert.equal(f.leads.length,1);assert.equal(f.user.leadsProcessed,1);assert.equal(f.leads[0].emailDraft,'');assert.equal(f.leads[0].linkedInDraft,'');assert.equal(f.memory.length,1);
});
test('quota, exhausted preview, invalid identity and self-contact fail closed',async()=>{
 const f=fixture();f.user.leadsProcessed=25;
 await assert.rejects(exports.importPreviewProspect('tenant','controlled@example.com',f.db),/QUOTA/);assert.equal(f.leads.length,0);
 await assert.rejects(exports.importPreviewProspect('tenant','owner@gmail.com',f.db),/DISTINCT/);
 assert.throws(()=>exports.controlledEmail('not an email'));
 f.db.decision.findFirst=async()=>({id:'used'});await assert.rejects(exports.importPreviewProspect('tenant','controlled@example.com',f.db),/EXHAUSTED/);
});
test('receipt requires exact sender, recipient, provider message IDs and post-purchase receipt',()=>{
 const since=new Date(Date.now()-1000);exports.validatePreviewReceipt(reply,'owner@gmail.com','controlled@example.com',since);
 for(const patch of [{from:'other@example.com'},{to:['other@gmail.com']},{messageId:'fabricated'},{inReplyTo:''},{text:''},{receivedAt:new Date(Date.now()-10000)},{receivedAt:new Date(Date.now()+600000)}])
  assert.throws(()=>exports.validatePreviewReceipt({...reply,...patch},'owner@gmail.com','controlled@example.com',since),/REAL_WORKFLOW/);
});
test('provider replay reuses one canonical signal, memory event and message; a different concurrent reply is blocked',async()=>{
 const f=fixture();const lead=await exports.importPreviewProspect('tenant','controlled@example.com',f.db);
 const a=await exports.persistPreviewReceipt('tenant',lead.id,'owner@gmail.com',reply,f.db);
 const b=await exports.persistPreviewReceipt('tenant',lead.id,'owner@gmail.com',reply,f.db);
 assert.equal(a.id,b.id);assert.equal(f.signals.length,1);assert.equal(f.messages.length,1);assert.equal(f.memory.length,2);
 assert.equal(f.signals[0].sourceType,'IMAP_NATIVE');assert.equal(f.signals[0].rawEmail,reply.text);assert.equal(f.signals[0].createdAt,reply.receivedAt);
 assert.match(f.signals[0].sourceMessageId,/^imap:[a-f0-9]{64}$/);assert.equal('appPassword' in f.signals[0],false);
 await assert.rejects(exports.persistPreviewReceipt('tenant',lead.id,'owner@gmail.com',{...reply,messageId:'<second@provider.example>'},f.db),/ALREADY_CAPTURED/);
 await assert.rejects(exports.persistPreviewReceipt('tenant','other-tenant-lead','owner@gmail.com',reply,f.db),/CONTROLLED_WORKFLOW/);
});
test('simultaneous different receipts persist only one preview source',async()=>{
 const f=fixture();const lead=await exports.importPreviewProspect('tenant','controlled@example.com',f.db);
 const results=await Promise.allSettled([exports.persistPreviewReceipt('tenant',lead.id,'owner@gmail.com',reply,f.db),
  exports.persistPreviewReceipt('tenant',lead.id,'owner@gmail.com',{...reply,messageId:'<another@provider.example>'},f.db)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.signals.length,1);assert.equal(f.messages.length,1);
});
