import {prisma} from '../prisma';
import {recordAIUsage,type AIUsageTokens} from '../ai/usage';
import {AIFeature,AIOperation,AIProvider,AIUsageStatus,type PrismaClient} from '@prisma/client';
import {selectTriageProvider,validateTriageOutput,classifyTriageFailure,type TriageFailureClass} from './provider';
export const B6_CLAUDE_SMOKE='B6_ANTHROPIC_SYNTHETIC_SMOKE';
const TENANT='cmsz65snq00016585j70is9qj';
export async function runAnthropicSmoke(db:PrismaClient=prisma){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${TENANT} FOR UPDATE`;
  if(await tx.aIUsageEvent.count({where:{userId:TENANT,requestId:B6_CLAUDE_SMOKE}}))return {status:'STOPPED',code:'SMOKE_ALREADY_EXECUTED'};
  const provider=selectTriageProvider();if(provider.provider!=='ANTHROPIC')return {status:'STOPPED',code:'ANTHROPIC_REQUIRED'};
  let usage:AIUsageTokens|null=null,started=false,phase:'PROVIDER'|'VALIDATION'='PROVIDER',failure:TriageFailureClass|null=null;
  const begin=Date.now();
  try{
   const result=await provider.analyze({contextText:JSON.stringify({CURRENT_REPLY:'What does the product cost?'})},
    {onRequestStart:()=>{started=true;},onResponse:value=>{usage=value;}});
   phase='VALIDATION';validateTriageOutput(result,'What does the product cost?');
  }catch(error){failure=classifyTriageFailure(error,phase);}
  if(started)try{await recordAIUsage({userId:TENANT,feature:AIFeature.INBOX_TRIAGE,operation:AIOperation.TRIAGE_ANALYSIS,
   provider:AIProvider.ANTHROPIC,model:provider.model!,usage,status:failure?AIUsageStatus.FAILED:AIUsageStatus.SUCCESS,
   latencyMs:Math.max(0,Date.now()-begin),requestId:B6_CLAUDE_SMOKE},tx as unknown as PrismaClient);}catch{failure='USAGE_RECORDING_FAILED';}
  return failure?{status:'STOPPED',code:failure}:{status:'PASS',provider:'ANTHROPIC',model:provider.model,validated:true,usagePersisted:true};
 },{maxWait:10000,timeout:90000});
}
