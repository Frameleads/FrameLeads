import {GoogleGenerativeAI,SchemaType,type ResponseSchema} from '@google/generative-ai';
import {TRIAGE_MODEL,TRIAGE_RESPONSE_SCHEMA,TRIAGE_SYSTEM_PROMPT,validateTriageOutput,safeGoogleDiagnostic} from './provider';
const CONTENT='Classify this synthetic message: What does the product cost?';
// Operator-only, fixed synthetic input. No database, customer context or usage writes.
export async function runSyntheticProviderProbe(probe:unknown){
 if(!['A','B','C','SMOKE'].includes(String(probe)))throw new Error('INVALID_PROVIDER_PROBE');
 const key=process.env.GEMINI_API_KEY;if(!key)return {status:'FAILED',code:'MISSING_API_KEY'};
 const schema:ResponseSchema|undefined=probe==='A'?undefined:probe==='B'?{type:SchemaType.OBJECT,properties:{primaryIntent:{type:SchemaType.STRING,format:'enum',enum:['PRICING_INQUIRY','OTHER']}},required:['primaryIntent']}:TRIAGE_RESPONSE_SCHEMA;
 try{
  const model=new GoogleGenerativeAI(key).getGenerativeModel({model:TRIAGE_MODEL,
   ...(probe==='C'||probe==='SMOKE'?{systemInstruction:TRIAGE_SYSTEM_PROMPT}:{}),
   generationConfig:{temperature:0.1,maxOutputTokens:1200,responseMimeType:'application/json',...(schema?{responseSchema:schema}:{})}});
  const result=await model.generateContent(probe==='C'||probe==='SMOKE'?JSON.stringify({CURRENT_REPLY:CONTENT}):CONTENT,{timeout:60000});
  const text=result.response.text();if(text.length>12000)return {status:'FAILED',code:'OUTPUT_VALIDATION_FAILED'};
  const parsed=JSON.parse(text);
  if(probe==='C'||probe==='SMOKE')validateTriageOutput(parsed,CONTENT);
  if(probe==='B'&&!['PRICING_INQUIRY','OTHER'].includes(parsed?.primaryIntent))return {status:'FAILED',code:'OUTPUT_VALIDATION_FAILED'};
  return {status:'PASS',httpStatus:200,structuredResponseValidated:probe!=='A'};
 }catch(error){return {status:'FAILED',diagnostic:safeGoogleDiagnostic(error)};}
}
