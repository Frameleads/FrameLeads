import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/customer-session.ts',import.meta.url),'utf8'),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,require:n=>n==='next/headers'?{cookies:()=>{throw Error('No browser session in test');}}:{prisma:{}},fetch:()=>{throw Error('No network in test');},AbortSignal});
test('arbitrary or expired cookie cannot select a customer by email',async()=>{
 const db={user:{findFirst:()=>{throw Error('Unauthenticated database lookup');}}};
 assert.equal(await exports.verifyCustomerSession(undefined,db),null);
 assert.equal(await exports.verifyCustomerSession('forged-cookie',db,async()=>({ok:false})),null);
});
test('fresh provider profile must match both Whop identity and normalized tenant email',async()=>{
 let reads=0;const db={user:{findFirst:async({where})=>{reads++;assert.equal(where.whopId,'user_real');assert.equal(where.email,'owner@example.com');return {id:'tenant',tier:'MICRO_PILOT'};}}};
 const r=await exports.verifyCustomerSession('isolated-token',db,async(url,options)=>{
  assert.equal(url,'https://api.whop.com/oauth/userinfo');assert.equal(options.headers.authorization,'Bearer isolated-token');assert.equal(options.redirect,'error');
  return {ok:true,text:async()=>JSON.stringify({sub:'user_real',email:' OWNER@example.com '})};
 });assert.equal(r.id,'tenant');assert.equal(reads,1);
 const missing={user:{findFirst:async()=>null}};
 assert.equal(await exports.verifyCustomerSession('isolated-token',missing,async()=>({ok:true,text:async()=>JSON.stringify({sub:'other',email:'owner@example.com'})})),null);
});
test('network failure and oversized provider response fail closed',async()=>{
 const db={user:{findFirst:()=>{throw Error('Must not read');}}};
 assert.equal(await exports.verifyCustomerSession('isolated-token',db,async()=>{throw Error('Unavailable');}),null);
 assert.equal(await exports.verifyCustomerSession('isolated-token',db,async()=>({ok:true,text:async()=> 'x'.repeat(8001)})),null);
});
