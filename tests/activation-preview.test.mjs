import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/decision/activation-preview.ts',import.meta.url),'utf8'),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
function fixture(tier='MICRO_PILOT'){
 const rows=[];let queue=Promise.resolve(),locks=0;
 const db={user:{findUnique:async()=>({tier})},
  decision:{findFirst:async q=>rows.find(r=>r.userId===q.where.userId),create:async({data})=>{const row={...data,id:'decision-'+rows.length};rows.push(row);return row;}},
  $queryRaw:async()=>{locks++;return [{tier}];},
  $transaction:async(work,options)=>{assert.equal(options.isolationLevel,'ReadCommitted');let release;const old=queue;queue=new Promise(r=>release=r);await old;try{return await work(db);}finally{release();}}};
 return {db,rows,locks:()=>locks};
}
const data={userId:'tenant',prospectId:'owned',inputMessageId:'reply-a',conversationId:'conversation',contextFingerprint:'a',decisionType:'INBOUND_TRIAGE'};
test('concurrent different replies reserve exactly one canonical Decision before analysis',async()=>{
 const f=fixture();const results=await Promise.allSettled([exports.reserveTriageDecision(f.db,data,true),exports.reserveTriageDecision(f.db,{...data,inputMessageId:'reply-b',contextFingerprint:'b'},true)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows.length,1);assert.equal(f.locks(),2);
 assert.match(results.find(r=>r.status==='rejected').reason.message,/EXHAUSTED/);
 assert.equal(f.rows[0].shadowMode,true);
});
test('failed or pending reservation never unlocks another execution; retries and ordinary Micro triage fail closed',async()=>{
 const f=fixture();await assert.rejects(exports.reserveTriageDecision(f.db,data,false),/LOCKED/);
 await assert.rejects(exports.reserveTriageDecision(f.db,{...data,supersedesDecisionId:'old'},true),/LOCKED/);
 await exports.reserveTriageDecision(f.db,data,true);f.rows[0].status='FAILED';
 await assert.rejects(exports.reserveTriageDecision(f.db,data,true),/EXHAUSTED/);assert.equal(f.rows.length,1);
});
test('Core and Enterprise canonical reservation remain unchanged',async()=>{
 for(const tier of ['CORE','ENTERPRISE']){const f=fixture(tier);await exports.reserveTriageDecision(f.db,data,false);await exports.reserveTriageDecision(f.db,{...data,inputMessageId:'other'},false);assert.equal(f.rows.length,2);assert.equal(f.locks(),0);}
 await assert.rejects(exports.reserveTriageDecision(fixture('INACTIVE').db,data,false),/LOCKED/);
});
test('preview accepts only real tenant-owned provider reply evidence',()=>{
 const signal={userId:'tenant',prospectId:'owned',sourceType:'WEBHOOK',signalType:'EMAIL_REPLY',sourceMessageId:'actual-provider-id',rawEmail:'A real reply'};
 assert.equal(exports.realPreviewReply(signal,'tenant'),true);
 for(const patch of [{userId:'other'},{sourceType:'MANUAL'},{sourceMessageId:'synthetic_fixture'},{sourceMessageId:null},{signalType:'BOUNCE'},{prospectId:null},{rawEmail:''}])assert.equal(exports.realPreviewReply({...signal,...patch},'tenant'),false);
});
