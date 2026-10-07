import {prisma} from '../prisma';
import {importPreviewProspect,persistPreviewReceipt} from './activation-preview-setup';
import {readPreviewGmailReply} from './activation-preview-gmail';
import {triageInboundSignal} from './triage';
import {canManuallyAnalyze} from './rollout';
import {qualifiesGovernedDecision,syncCustomerLifecycle} from '../customer-lifecycle';

export const B6_CUSTOMER='akramwalid628@gmail.com',B6_PROSPECT='akram@frameleads.io';
export type AcceptanceInput={B6_ACCEPTANCE_RUN?:string;B6_ACCEPTANCE_CUSTOMER_EMAIL?:string;B6_CONTROLLED_PROSPECT_EMAIL?:string;B6_REPLY_MESSAGE_ID?:string;B6_GMAIL_APP_PASSWORD?:string};
export function validateAcceptanceInput(input:AcceptanceInput){
 if(input.B6_ACCEPTANCE_RUN!=='true')throw new Error('ACCEPTANCE_RUN_DISABLED');
 if(input.B6_ACCEPTANCE_CUSTOMER_EMAIL!==B6_CUSTOMER||input.B6_CONTROLLED_PROSPECT_EMAIL!==B6_PROSPECT)throw new Error('CONTROLLED_IDENTITY_REQUIRED');
 if(typeof input.B6_REPLY_MESSAGE_ID!=='string'||!/^<[^<>\s]{1,180}>$/.test(input.B6_REPLY_MESSAGE_ID)||
  typeof input.B6_GMAIL_APP_PASSWORD!=='string'||input.B6_GMAIL_APP_PASSWORD.length>64||!/^[a-zA-Z0-9]{16,64}$/.test(input.B6_GMAIL_APP_PASSWORD.replace(/\s/g,'')))throw new Error('PROVIDER_INPUT_REQUIRED');
}
export async function readAcceptancePreflight(db=prisma){
 const users=await db.user.findMany({where:{email:B6_CUSTOMER},take:2,select:{id:true,tier:true,whopId:true}});
 if(users.length!==1||users[0].tier!=='MICRO_PILOT'||!users[0].whopId||/^(demo|test|fixture|synthetic|dev)[_:-]/i.test(users[0].whopId))throw new Error('REAL_MICRO_PILOT_CUSTOMER_REQUIRED');
 const user=users[0],policy=await db.salesConstitution.findUnique({where:{userId:user.id},select:{revision:true}});
 return {userId:user.id,policyReady:Boolean(policy&&policy.revision>0),decisionCount:await db.decision.count({where:{userId:user.id}}),analysisEnabled:canManuallyAnalyze()};
}
/** Only the authenticated operator route calls this. No execution/scheduler/provider-send dependency. */
export async function runControlledAcceptance(input:AcceptanceInput){
 try{
  validateAcceptanceInput(input);
  const preflight=await readAcceptancePreflight();
  if(!preflight.policyReady)throw new Error('EXISTING_SALES_POLICY_REQUIRED');
  if(!preflight.analysisEnabled)throw new Error('DECISION_ANALYSIS_DISABLED');
  if(preflight.decisionCount)throw new Error('ACTIVATION_PREVIEW_EXHAUSTED');
  const before=await syncCustomerLifecycle(B6_CUSTOMER);
  if(before.status!=='VERIFIED'||before.onboarding?.purchased_offer!=='MICRO_PILOT'||before.onboarding?.product_user_id!==preflight.userId||before.onboarding?.activated_at)throw new Error('VERIFIED_CUSTOMER_ENROLLMENT_REQUIRED');
  const since=new Date(before.onboarding.started_at);if(!Number.isFinite(since.getTime()))throw new Error('PURCHASE_CONTEXT_REQUIRED');
  const lead=await importPreviewProspect(preflight.userId,B6_PROSPECT);
  const reply=await readPreviewGmailReply({mailbox:B6_CUSTOMER,prospectEmail:B6_PROSPECT,messageId:input.B6_REPLY_MESSAGE_ID!,appPassword:input.B6_GMAIL_APP_PASSWORD!,since});
  input.B6_GMAIL_APP_PASSWORD='';
  const signal=await persistPreviewReceipt(preflight.userId,lead.id,B6_CUSTOMER,reply);
  // Durable canonical reservation owns concurrency. Never retry this call after a transport failure.
  await triageInboundSignal({userId:preflight.userId,signalId:signal.id,activationPreview:true});
  const decision=await prisma.decision.findFirst({where:{userId:preflight.userId},include:{trace:true,inputMessage:true}});
  const source=await prisma.inboundSignal.findFirst({where:{id:signal.id,userId:preflight.userId}});
  if(!qualifiesGovernedDecision(decision,source))throw new Error('SAVED_DECISION_REQUIRES_OPERATOR_REVIEW');
  if(await prisma.decision.count({where:{userId:preflight.userId}})!==1)throw new Error('DECISION_COUNT_CONFLICT');
  if(await prisma.decisionExecutionAttempt.count({where:{userId:preflight.userId,decisionId:decision!.id}}))throw new Error('UNEXPECTED_EXECUTION_ATTEMPT');
  const after=await syncCustomerLifecycle(B6_CUSTOMER),repeat=await syncCustomerLifecycle(B6_CUSTOMER);
  if(after.onboarding?.state!=='ACTIVATED'||after.onboarding?.first_governed_decision_id!==decision!.id||repeat.onboarding?.first_governed_decision_id!==decision!.id)throw new Error('ACTIVATION_READBACK_REQUIRED');
  const exhausted=await readAcceptancePreflight();
  return {status:'ACTIVATED',signalId:signal.id,decisionId:decision!.id,traceId:decision!.trace!.id,onboardingId:after.onboarding.id,
   furtherDecisionsLocked:exhausted.decisionCount===1,projectionRepeated:true,emailsSent:0};
 }finally{input.B6_GMAIL_APP_PASSWORD='';}
}
