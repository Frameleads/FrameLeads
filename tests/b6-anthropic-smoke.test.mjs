import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import * as prismaTypes from '@prisma/client';
function fixture(fail=false){let calls=0;const rows=[];const db={$queryRaw:async()=>[],aIUsageEvent:{count:async()=>rows.length},$transaction:async work=>work(db)};
 const provider={provider:'ANTHROPIC',model:'claude-haiku-4-5',analyze:async(request,observer)=>{
  calls++;assert.equal(request.contextText,'{"CURRENT_REPLY":"What does the product cost?"}');observer.onRequestStart();
  if(fail)throw {status:401,message:'secret provider body'};observer.onResponse({inputTokens:15,outputTokens:20,totalTokens:35});return {valid:true};}};
 const modules={'../prisma':{prisma:db},'@prisma/client':prismaTypes,'../ai/usage':{recordAIUsage:async value=>{rows.push(value);}},
 './provider':{selectTriageProvider:()=>provider,validateTriageOutput:value=>{assert.equal(value.valid,true);},classifyTriageFailure:()=> 'AUTH_FAILED'}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/decision/b6-anthropic-smoke.ts',import.meta.url),'utf8'),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{assert.ok(modules[n],`Forbidden dependency ${n}`);return modules[n];},Date});
 return {api:exports,rows,calls:()=>calls};
}
test('synthetic smoke validates and persists Anthropic tokens once without Decision or email dependencies',async()=>{
 const f=fixture();assert.equal((await f.api.runAnthropicSmoke()).status,'PASS');assert.equal(f.rows.length,1);
 assert.equal(f.rows[0].provider,'ANTHROPIC');assert.equal(f.rows[0].status,'SUCCESS');assert.equal(f.rows[0].usage.totalTokens,35);
 assert.equal((await f.api.runAnthropicSmoke()).code,'SMOKE_ALREADY_EXECUTED');assert.equal(f.calls(),1);
});
test('failed smoke records FAILED usage, exposes only a safe class and never retries',async()=>{
 const f=fixture(true);const result=await f.api.runAnthropicSmoke();assert.equal(result.code,'AUTH_FAILED');assert.ok(!JSON.stringify(result).includes('secret'));
 assert.equal(f.rows[0].status,'FAILED');assert.equal((await f.api.runAnthropicSmoke()).code,'SMOKE_ALREADY_EXECUTED');assert.equal(f.calls(),1);
});
