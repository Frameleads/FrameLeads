import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function fixture(){
 let calls=0,config,input,validated=0;
 const modules={'@google/generative-ai':{SchemaType:{OBJECT:'object',STRING:'string'},GoogleGenerativeAI:class{
  getGenerativeModel(value){config=value;return {generateContent:async value=>{calls++;input=value;return {response:{text:()=>'{"primaryIntent":"PRICING_INQUIRY"}'}}}};}
 }},'./provider':{TRIAGE_MODEL:'gemini-2.5-flash',TRIAGE_RESPONSE_SCHEMA:{type:'object'},TRIAGE_SYSTEM_PROMPT:'taxonomy',
  validateTriageOutput:()=>{validated++;},safeGoogleDiagnostic:()=>({reason:'UNKNOWN_4XX'})}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/decision/b6-provider-probe.ts',import.meta.url),'utf8'),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,process:{env:{GEMINI_API_KEY:'fake-test-key'}},require:name=>{assert.ok(modules[name],`Forbidden dependency ${name}`);return modules[name];}});
 return {api:exports,calls:()=>calls,config:()=>config,input:()=>input,validated:()=>validated};
}
test('synthetic probe refuses arbitrary modes before calling the provider',async()=>{
 const f=fixture();await assert.rejects(f.api.runSyntheticProviderProbe('customer-context'));assert.equal(f.calls(),0);
});
test('A omits schema; B uses tiny schema; C and smoke validate fixed synthetic content without database imports',async()=>{
 for(const mode of ['A','B','C','SMOKE']){
  const f=fixture();assert.equal((await f.api.runSyntheticProviderProbe(mode)).status,'PASS');assert.equal(f.calls(),1);
  assert.ok(f.input().includes('Classify this synthetic message: What does the product cost?'));
  assert.equal(f.validated(),['C','SMOKE'].includes(mode)?1:0);
  if(mode==='A')assert.equal(f.config().generationConfig.responseSchema,undefined);
  if(mode==='B')assert.deepEqual(Array.from(f.config().generationConfig.responseSchema.properties.primaryIntent.enum),['PRICING_INQUIRY','OTHER']);
 }
});
