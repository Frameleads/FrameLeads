import {prisma} from '../prisma';
import type {PrismaClient} from '@prisma/client';
import {realPreviewReply} from './activation-preview';
import {buildReplyDecisionContext} from './context';
import {analyzeAndFinalizeReservedTriage,type TriageDependencies} from './triage';
import {readAcceptancePreflight,B6_CUSTOMER,B6_PROSPECT} from './b6-controlled-acceptance';
import {B6_SIGNAL} from './b6-persisted-signal';
import {qualifiesGovernedDecision,syncCustomerLifecycle} from '../customer-lifecycle';

export const B6_PENDING_DECISION='cmuyn5uii001y12uq4lk5oebf';
const TENANT='cmsz65snq00016585j70is9qj';
export function validatePendingRecoveryInput(input:{mode?:string;signalId?:string;decisionId?:string}){
 if(input.mode!=='RECOVER_PENDING_DECISION'||input.signalId!==B6_SIGNAL||input.decisionId!==B6_PENDING_DECISION||Object.keys(input).length!==3)
  throw new Error('FIXED_PENDING_RECOVERY_REQUIRED');
}

/** Read only: no reservation, projection, receipt/import, context initialization or provider. */
export async function pendingRecoveryState(db=prisma){
 const p=await readAcceptancePreflight(db);
 if(p.userId!==TENANT||!p.policyReady||!p.analysisEnabled||p.decisionCount!==1)throw new Error('RECOVERY_PREFLIGHT_FAILED');
 const [decision,signal,constitution,attempts,usageCount]=await Promise.all([
  db.decision.findFirst({where:{id:B6_PENDING_DECISION,userId:TENANT},include:{trace:true,inputMessage:true}}),
  db.inboundSignal.findFirst({where:{id:B6_SIGNAL,userId:TENANT}}),
  db.salesConstitution.findUnique({where:{userId:TENANT},select:{revision:true}}),
  db.decisionExecutionAttempt.count({where:{userId:TENANT}}),
  db.aIUsageEvent.count({where:{userId:TENANT,feature:'INBOX_TRIAGE',operation:'TRIAGE_ANALYSIS'}}),
 ]);
 if(!decision||decision.status!=='PENDING'||decision.trace!==null||!signal||!realPreviewReply(signal,TENANT)||
  constitution?.revision!==1||attempts!==0||usageCount!==1||decision.supersedesDecisionId||!decision.shadowMode||decision.decisionType!=='INBOUND_TRIAGE'||
  decision.inputMessage.id!==decision.inputMessageId||
  decision.prospectId!==signal.prospectId||decision.inputMessage.userId!==TENANT||decision.inputMessage.prospectId!==signal.prospectId||
  decision.inputMessage.sourceType!=='INBOUND_SIGNAL'||decision.inputMessage.sourceId!==B6_SIGNAL||
  decision.inputMessage.direction!=='INBOUND'||decision.inputMessage.conversationId!==decision.conversationId)
  throw new Error('RECOVERY_EVIDENCE_REQUIRED');
 const [prospect,lead,conversation]=await Promise.all([
  db.prospect.findFirst({where:{userId:TENANT,id:signal.prospectId!,normalizedEmail:B6_PROSPECT},select:{id:true}}),
  db.generatedLead.findFirst({where:{userId:TENANT,prospectId:signal.prospectId,email:B6_PROSPECT},select:{id:true}}),
  db.conversation.findFirst({where:{id:decision.conversationId,userId:TENANT,prospectId:signal.prospectId!}}),
 ]);
 if(!prospect||!lead||!conversation)throw new Error('RECOVERY_OWNERSHIP_REQUIRED');
 return {userId:TENANT,decision,linked:{signal,conversation,message:decision.inputMessage}};
}
export async function readPendingRecoveryPreflight(db=prisma){
 const s=await pendingRecoveryState(db);
 return {status:'RECOVERY_READY',decisionId:s.decision.id,signalId:B6_SIGNAL,decisionCount:1,traceCount:0,policyReady:true,constitutionRevision:1};
}

/** Fixed operator recovery. User-row lock serializes concurrent requests without creating a reservation.
 * Existing usage count rejects replay after a recorded attempt, including a FAILED recovery.
 * Failed providers commit telemetry only, leaving the existing PENDING row and trace unchanged. */
export async function recoverPendingDecision(input:{mode?:string;signalId?:string;decisionId?:string},deps:TriageDependencies={},
 lifecycle=syncCustomerLifecycle){
 validatePendingRecoveryInput(input);
 const db=deps.db??prisma;
 const initial=await pendingRecoveryState(db);
 const before=await lifecycle(B6_CUSTOMER);
 if(before.status!=='VERIFIED'||before.onboarding?.product_user_id!==TENANT||before.onboarding?.purchased_offer!=='MICRO_PILOT'||
  before.onboarding?.state!=='READY_FOR_DECISION'||before.onboarding?.activated_at)throw new Error('RECOVERY_ONBOARDING_REQUIRED');
 const context=await (deps.buildContext??buildReplyDecisionContext)({userId:TENANT,prospectId:initial.decision.prospectId,
  conversationId:initial.decision.conversationId,messageId:initial.decision.inputMessageId},db);
 if(context.contextFingerprint!==initial.decision.contextFingerprint||context.constitution.revision!==1)throw new Error('RECOVERY_CONTEXT_CHANGED');
 const result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${TENANT} FOR UPDATE`;
  const txDb=tx as unknown as PrismaClient;
  const state=await pendingRecoveryState(txDb);
  return analyzeAndFinalizeReservedTriage({userId:TENANT,linked:state.linked,context,pending:state.decision,
   fingerprint:state.decision.contextFingerprint,strictRecovery:true},{...deps,db:txDb});
 },{isolationLevel:'ReadCommitted',maxWait:10_000,timeout:120_000});
 if(result.status==='STOPPED')return {status:'STOPPED',code:result.failureClass,decisionId:B6_PENDING_DECISION,signalId:B6_SIGNAL,outcome:'NO_RETRY'};
 const decision=await db.decision.findFirst({where:{id:B6_PENDING_DECISION,userId:TENANT},include:{trace:true,inputMessage:true}});
 const signal=await db.inboundSignal.findFirst({where:{id:B6_SIGNAL,userId:TENANT}});
 if(!qualifiesGovernedDecision(decision,signal)||decision?.source!=='GEMINI'||decision.trace?.constitutionRevision!==1||
  !Array.isArray(decision.trace?.policyResult)||!(decision.trace!.policyResult as any[]).every(p=>p.revision===1)||await db.decision.count({where:{userId:TENANT}})!==1||
  await db.decisionExecutionAttempt.count({where:{userId:TENANT}})!==0)throw new Error('RECOVERY_TRACE_VERIFICATION_FAILED');
 const after=await lifecycle(B6_CUSTOMER),repeat=await lifecycle(B6_CUSTOMER);
 if(after.onboarding?.state!=='ACTIVATED'||after.onboarding?.first_governed_decision_id!==B6_PENDING_DECISION||
  repeat.onboarding?.first_governed_decision_id!==B6_PENDING_DECISION)throw new Error('RECOVERY_ACTIVATION_FAILED');
 return {status:'ACTIVATED',decisionId:B6_PENDING_DECISION,signalId:B6_SIGNAL,traceId:decision!.trace!.id,
  onboardingId:after.onboarding.id,emailsSent:0,furtherDecisionsLocked:true};
}
