import {prisma} from '../prisma';
import {getInboundConversationMessage} from './conversation';
import {realPreviewReply} from './activation-preview';
import {getProspectMemoryContext} from '../prospects/memory';
import {getBrainContext} from '../brain';
import {getPlaybookContext} from '../revenue-playbook';
import {getSalesConstitutionContext} from '../sales-constitution';
import {buildReplyDecisionContext} from './context';
import {readAcceptancePreflight,B6_CUSTOMER,B6_PROSPECT} from './b6-controlled-acceptance';
import {triageInboundSignal} from './triage';
import {qualifiesGovernedDecision,syncCustomerLifecycle} from '../customer-lifecycle';

export const B6_SIGNAL='f819e17e-afff-4995-8754-9a5dc0897414';
type Stage={stage:string;status:'PASS'|'FAIL';errorClass?:string;prismaCode?:string|null;model?:string|null;reason?:string};
// Never return the exception message, stack, query, context text or provider response.
export function safeDiagnosticError(error:unknown){
 const e=error as {name?:string;code?:string;meta?:{modelName?:string}};
 const names=['Error','TypeError','PrismaClientValidationError','PrismaClientKnownRequestError','PrismaClientUnknownRequestError','PrismaClientInitializationError'];
 const models=['ProspectMemoryEvent','ProspectMemoryState','FrameLeadsBrain','RevenuePlaybook','SalesConstitution','Decision','ConversationMessage'];
 return {errorClass:names.includes(e?.name??'')?e.name!:'Error',prismaCode:/^P\d{4}$/.test(e?.code??'')?e.code!:null,
  model:models.includes(e?.meta?.modelName??'')?e.meta!.modelName!:null,reason:'CANONICAL_STAGE_FAILED'};
}

/** Fixed operator-only scope. Canonical bounded lazy projections may initialize memory/context;
 * no signal/prospect creation, Decision reservation, mailbox access or model execution. */
export async function diagnosePersistedSignal(db=prisma){
 const stages:Stage[]=[];
 const check=async(stage:string,work:()=>Promise<unknown>)=>{try{await work();stages.push({stage,status:'PASS'});}
  catch(error){stages.push({stage,status:'FAIL',...safeDiagnosticError(error)});}};
 let userId='',signal:any,linked:any;
 await check('SIGNAL_LOOKUP',async()=>{
  const preflight=await readAcceptancePreflight(db);userId=preflight.userId;
  signal=await db.inboundSignal.findFirst({where:{id:B6_SIGNAL,userId}});
  if(!signal?.prospectId)throw new Error('CONTROLLED_SIGNAL_REQUIRED');
 });
 await check('CONVERSATION_MESSAGE_LOAD',async()=>{
  if(!signal)throw new Error('SIGNAL_REQUIRED');
  linked=await getInboundConversationMessage({userId,signalId:B6_SIGNAL},db);
  if(!linked.message||!linked.conversation)throw new Error('CONVERSATION_REQUIRED');
 });
 await check('ACTIVATION_PREVIEW_EVIDENCE',async()=>{if(!signal||!realPreviewReply(signal,userId))throw new Error('REAL_PROVIDER_REPLY_REQUIRED');});
 await check('CONTROLLED_GENERATED_LEAD',async()=>{
  const lead=signal&&await db.generatedLead.findFirst({where:{userId,prospectId:signal.prospectId,email:B6_PROSPECT},select:{id:true}});
  const prospect=signal&&await db.prospect.findFirst({where:{id:signal.prospectId,userId,normalizedEmail:B6_PROSPECT},select:{id:true}});
  if(!lead||!prospect)throw new Error('CONTROLLED_WORKFLOW_PROSPECT_REQUIRED');
 });
 const scope={userId,prospectId:signal?.prospectId??''};
 await check('PROSPECT_MEMORY_CONTEXT',()=>getProspectMemoryContext({...scope,purpose:'INBOX',maxEvents:6},db));
 await check('BRAIN_CONTEXT',()=>getBrainContext({userId,purpose:'reply_decision',maxEntries:6,maxCharacters:1700},db));
 await check('REVENUE_PLAYBOOK_CONTEXT',()=>getPlaybookContext({userId,purpose:'reply_decision',maxRules:4,maxCharacters:1300},db));
 await check('SALES_CONSTITUTION_CONTEXT',()=>getSalesConstitutionContext({userId,purpose:'reply_decision',maxRules:5,maxCharacters:1400},db));
 await check('REPLY_DECISION_CONTEXT_ASSEMBLY',async()=>{
  if(!linked?.message)throw new Error('MESSAGE_REQUIRED');
  await buildReplyDecisionContext({...scope,conversationId:linked.conversation.id,messageId:linked.message.id},db);
 });
 await check('EXISTING_DECISION_LOOKUP',()=>db.decision.findMany({where:{userId},take:2,select:{id:true,status:true}}));
 await check('RESERVATION_PREREQUISITES',async()=>{
  const p=await readAcceptancePreflight(db);
  if(!p.policyReady||!p.analysisEnabled||p.decisionCount!==0)throw new Error('RESERVATION_NOT_ALLOWED');
 });
 return {status:stages.every(s=>s.status==='PASS')?'DIAGNOSTIC_READY':'DIAGNOSTIC_BLOCKED',signalId:B6_SIGNAL,stages};
}

/** One canonical execution from existing verified evidence. No receipt/import path and no retry. */
export async function resumePersistedSignal(){
 let stage='PRODUCT_PREFLIGHT_FAILED';
 try{
  const preflight=await readAcceptancePreflight();
  if(!preflight.policyReady||!preflight.analysisEnabled||preflight.decisionCount!==0)throw new Error('RESERVATION_NOT_ALLOWED');
  stage='CUSTOMER_ENROLLMENT_FAILED';
  const before=await syncCustomerLifecycle(B6_CUSTOMER);
  if(before.status!=='VERIFIED'||before.onboarding?.purchased_offer!=='MICRO_PILOT'||before.onboarding?.product_user_id!==preflight.userId||before.onboarding?.activated_at)throw new Error('VERIFIED_CUSTOMER_ENROLLMENT_REQUIRED');
  stage='PERSISTED_SIGNAL_PREFLIGHT_FAILED';
  const diagnostic=await diagnosePersistedSignal();
  if(diagnostic.status!=='DIAGNOSTIC_READY')throw new Error('PERSISTED_SIGNAL_NOT_READY');
  stage='GOVERNED_DECISION_FAILED';
  await triageInboundSignal({userId:preflight.userId,signalId:B6_SIGNAL,activationPreview:true});
  stage='DECISION_TRACE_VERIFICATION_FAILED';
  const decision=await prisma.decision.findFirst({where:{userId:preflight.userId},include:{trace:true,inputMessage:true}});
  const source=await prisma.inboundSignal.findFirst({where:{id:B6_SIGNAL,userId:preflight.userId}});
  if(!qualifiesGovernedDecision(decision,source)||await prisma.decision.count({where:{userId:preflight.userId}})!==1||
   await prisma.decisionExecutionAttempt.count({where:{userId:preflight.userId}}))throw new Error('CANONICAL_DECISION_REQUIRED');
  stage='ACTIVATION_READBACK_FAILED';
  const after=await syncCustomerLifecycle(B6_CUSTOMER),repeat=await syncCustomerLifecycle(B6_CUSTOMER);
  if(after.onboarding?.state!=='ACTIVATED'||after.onboarding?.first_governed_decision_id!==decision!.id||repeat.onboarding?.first_governed_decision_id!==decision!.id)throw new Error('ACTIVATION_READBACK_REQUIRED');
  return {status:'ACTIVATED',signalId:B6_SIGNAL,decisionId:decision!.id,traceId:decision!.trace!.id,onboardingId:after.onboarding.id,
   furtherDecisionsLocked:true,projectionRepeated:true,emailsSent:0};
 }catch(error){console.error('[B6_RESUME]',JSON.stringify({stage,...safeDiagnosticError(error)}));throw new Error(stage);}
}
