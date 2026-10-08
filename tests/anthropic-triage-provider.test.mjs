import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import {TriageIntent} from '@prisma/client';
const answer={primaryIntent:'PRICING_INQUIRY',intents:[{intent:'PRICING_INQUIRY',confidence:90,evidence:'What does the product cost?'}],overallConfidence:90,
 conciseInterpretation:'Asks for pricing.',recommendedNextAction:'ASK_CLARIFYING_QUESTION',suggestedReply:null,explanation:'Pricing is not supplied.'};
function fixture(failure){let calls=0,options,request;const env={TRIAGE_AI_PROVIDER:'ANTHROPIC',ANTHROPIC_API_KEY:'fake-test-key'};
 const exports={};const modules={'@prisma/client':{TriageIntent},'../prospects/research-provider':{geminiUsageTokens:()=>null},
 '@google/generative-ai':{SchemaType:{STRING:'string',OBJECT:'object',ARRAY:'array',INTEGER:'integer'}},
 '@anthropic-ai/sdk':class {constructor(value){options=value;}messages={create:async value=>{calls++;request=value;if(failure)throw failure;
  return {model:'claude-haiku-4-5-20251001',stop_reason:'end_turn',usage:{input_tokens:10,cache_creation_input_tokens:2,cache_read_input_tokens:3,output_tokens:20},content:[{type:'text',text:JSON.stringify(answer)}]};}}}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/decision/provider.ts',import.meta.url),'utf8'),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,
 {exports,require:n=>{assert.ok(modules[n],`Forbidden dependency ${n}`);return modules[n];},process:{env}});
 return {api:exports,calls:()=>calls,options:()=>options,request:()=>request};
}
test('Claude SDK uses supported structured output, disables retries and reports real token usage',async()=>{
 const f=fixture();let starts=0,usage;
 const provider=f.api.selectTriageProvider();const result=await provider.analyze({contextText:'CURRENT_REPLY: What does the product cost?'},{onRequestStart:()=>starts++,onResponse:x=>usage=x});
 assert.equal(provider.model,'claude-haiku-4-5-20251001');
 assert.equal(starts,1);assert.equal(f.calls(),1);assert.equal(f.options().maxRetries,0);assert.equal(f.options().timeout,60000);
 assert.equal(f.request().model,'claude-haiku-4-5');assert.equal(f.request().output_config.format.type,'json_schema');
 assert.equal(f.request().output_config.format.schema.additionalProperties,false);
 assert.equal(usage.inputTokens,15);assert.equal(usage.outputTokens,20);assert.equal(usage.totalTokens,35);assert.equal(usage.cachedInputTokens,3);
 assert.equal(f.api.validateTriageOutput(result,'What does the product cost?').primaryIntent,'PRICING_INQUIRY');
});
test('Claude failure performs one SDK invocation and produces only a bounded failure code',async()=>{
 const f=fixture({status:401,message:'secret raw body'});let error;
 try{await f.api.selectTriageProvider().analyze({contextText:'synthetic'});}catch(e){error=e;}
 assert.equal(f.calls(),1);assert.equal(f.api.classifyTriageFailure(error,'PROVIDER'),'AUTH_FAILED');
});
