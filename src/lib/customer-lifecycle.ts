import { createHash, timingSafeEqual } from 'node:crypto';
import { prisma } from './prisma';
import {getVercelOidcToken} from '@vercel/oidc';

export function lifecycleAuthorized(request: Request) {
  const secret = process.env.CUSTOMER_LIFECYCLE_BRIDGE_SECRET;
  const value = request.headers.get('authorization') ?? '';
  return Boolean(secret && secret.length >= 32 && secret.length <= 256 &&
    timingSafeEqual(createHash('sha256').update(value).digest(), createHash('sha256').update('Bearer '+secret).digest()));
}

export async function boundedLifecycleBody(request:Request){
 const reader=request.body?.getReader();if(!reader) throw new Error('BODY_REQUIRED');
 const decoder=new TextDecoder();let size=0,text='';
 try{while(true){const chunk=await reader.read();if(chunk.done) break;size+=chunk.value.byteLength;if(size>1024) throw new Error('BODY_TOO_LARGE');text+=decoder.decode(chunk.value,{stream:true});}
  return text+decoder.decode();
 }finally{await reader.cancel();reader.releaseLock();}
}

/** Sandbox simulation never writes these records. Only authenticated provider replies qualify. */
export function qualifiesGovernedDecision(d: any, signal: any) {
  return Boolean(d && ['READY','NEEDS_REVIEW'].includes(d.status) && ['DETERMINISTIC','GEMINI'].includes(d.source) &&
    d.trace && d.trace.userId === d.userId && d.trace.decisionId === d.id &&
    d.trace.inputMessageId === d.inputMessageId && d.trace.contextFingerprint === d.contextFingerprint &&
    d.inputMessage?.userId === d.userId && d.inputMessage?.direction === 'INBOUND' &&
    d.inputMessage?.sourceType === 'INBOUND_SIGNAL' && signal?.id === d.inputMessage?.sourceId &&
    signal.userId === d.userId && signal.prospectId === d.prospectId &&
    ['WEBHOOK','IMAP_NATIVE','PROVIDER_CONFIRMED'].includes(signal.sourceType) &&
    signal.sourceMessageId && !/^(demo|sample|test|fixture|synthetic)[_:-]/i.test(signal.sourceMessageId) &&
    Array.isArray(d.trace.policyResult) && d.trace.policyResult.length > 0 &&
    d.trace.policyResult.every((p: any) => p && p.configurationMissing === false &&
      p.authority==='SALES_CONSTITUTION' && p.revision>0 && ['ALLOWED','BLOCKED','REQUIRES_REVIEW'].includes(p.decision) &&
      (p.effectiveEffect===null || typeof p.effectiveEffect==='string')) &&
    !d.reviewReasons?.some((r: string) => /FAILED|UNAVAILABLE/.test(r)));
}

export async function readCustomerMilestones(email: string, since: Date, db = prisma) {
  const users = await db.user.findMany({ where: { email: { equals: email, mode: 'insensitive' } }, take: 2,
    select: { id:true, email:true, whopId:true, tier:true, createdAt:true } });
  if (!users.length) return { status:'PRODUCT_ACCOUNT_REQUIRED', email, milestones:[] };
  if (users.length !== 1 || !users[0].whopId || /^(demo|sample|test|fixture|synthetic|dev)[_:-]/i.test(users[0].whopId) || !['MICRO_PILOT','CORE','ENTERPRISE'].includes(users[0].tier)) throw new Error('PRODUCT_IDENTITY_CONFLICT');
  const user = users[0];
  const milestones: Record<string, unknown>[] = [];
  const add = (milestone: string, evidenceId: string, occurred: Date, decisionId?: string) => {
    const occurredAt = occurred.toISOString();
    const eventId = createHash('sha256').update([user.id,since.toISOString(),milestone,evidenceId].join(':')).digest('hex');
    milestones.push({eventId,email,productUserId:user.id,milestone,evidenceId,occurredAt,source:'CANONICAL_PRODUCT',
      ...(decisionId ? {decisionId,evidenceKind:'DECISION_TRACE'} : {})});
  };
  add('PRODUCT_ACCESS_CONFIRMED',user.id,new Date(Math.max(user.createdAt.getTime(),since.getTime())));
  const prospect = await db.prospect.findFirst({where:{userId:user.id,createdAt:{gte:since}},orderBy:{createdAt:'asc'},select:{id:true,createdAt:true}});
  if(prospect) add('PROSPECTS_IMPORTED',prospect.id,prospect.createdAt);
  const signal = await db.inboundSignal.findFirst({where:{userId:user.id,prospectId:{not:null},
    sourceType:{in:['WEBHOOK','IMAP_NATIVE','PROVIDER_CONFIRMED']},sourceMessageId:{not:null},createdAt:{gte:since}},orderBy:{createdAt:'asc'},
    select:{id:true,createdAt:true}});
  if(signal) add('FIRST_REPLY_RECEIVED',signal.id,signal.createdAt);
  // Bounded scan; an incomplete/failed earlier decision cannot hide a later valid one.
  const decisions = await db.decision.findMany({where:{userId:user.id,createdAt:{gte:since},status:{in:['READY','NEEDS_REVIEW']}},
    orderBy:{createdAt:'asc'},take:50,include:{trace:true,inputMessage:true}});
  for(const decision of decisions){
    const source = decision.inputMessage.sourceType === 'INBOUND_SIGNAL' ? await db.inboundSignal.findFirst({where:{id:decision.inputMessage.sourceId,userId:user.id}}) : null;
    if(qualifiesGovernedDecision(decision,source)){
      add('FIRST_GOVERNED_DECISION',decision.trace!.id,decision.trace!.createdAt,decision.id);break;
    }
  }
  return {status:'VERIFIED',email,productUserId:user.id,tier:user.tier,milestones};
}

export async function syncCustomerLifecycle(email: string, diagnostic = false) {
  const url=process.env.BRAND_BRAIN_CUSTOMER_MILESTONE_URL, secret=process.env.CUSTOMER_LIFECYCLE_BRIDGE_SECRET;
  if(!url || !secret) return {status:'BRIDGE_NOT_CONFIGURED'};
  const target=new URL(url);
  if(target.protocol!=='https:' || target.pathname!=='/api/customer-lifecycle/milestone') throw new Error('INVALID_LIFECYCLE_DESTINATION');
  let oidc:string|null=null;
  try{oidc=process.env.VERCEL ? await getVercelOidcToken() : null;}catch{throw new Error('LIFECYCLE_OIDC_UNAVAILABLE');}
  const response=await fetch(target,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+secret,
    ...(oidc ? {'x-vercel-trusted-oidc-idp-token':oidc} : {}),
    ...(process.env.BRAND_BRAIN_CUSTOMER_PROTECTION_BYPASS ? {'x-vercel-protection-bypass':process.env.BRAND_BRAIN_CUSTOMER_PROTECTION_BYPASS} : {})},
    body:JSON.stringify({email}),signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!response.ok){
    // Only this authenticated operator path receives safe claim fields, never the JWT or response body.
    let identity:Record<string,unknown>|null=null;
    if(diagnostic && oidc)try{const claims=JSON.parse(Buffer.from(oidc.split('.')[1],'base64url').toString());
      identity=Object.fromEntries(['iss','aud','sub','owner','owner_id','project','project_id','environment'].map(k=>[k,claims[k]]));
    }catch{}
    let applicationCode:string|null=null;
    if(diagnostic && response.headers.get('content-type')?.includes('application/json'))try{
      const body=await response.text();if(body.length<1024){const code=JSON.parse(body).code;
        if(['UNAUTHORIZED','CUSTOMER_MILESTONE_UNAVAILABLE','INVALID_REQUEST'].includes(code))applicationCode=code;}
    }catch{}
    throw new Error('LIFECYCLE_SYNC_UNAVAILABLE',{cause:diagnostic?{upstreamStatus:response.status,applicationCode,identity}:undefined});
  }
  const text=await response.text();if(text.length>16000) throw new Error('LIFECYCLE_RESPONSE_TOO_LARGE');
  return JSON.parse(text);
}

/** Projection failure cannot rewrite/reject a completed product decision. */
export async function projectCustomerProgress(userId:string){
 if(!process.env.CUSTOMER_LIFECYCLE_BRIDGE_SECRET || !process.env.BRAND_BRAIN_CUSTOMER_MILESTONE_URL) return;
 try{const user=await prisma.user.findUnique({where:{id:userId},select:{email:true}});
  if(user) await syncCustomerLifecycle(user.email.trim().toLowerCase());
 }catch{console.error('[CUSTOMER_LIFECYCLE] Projection unavailable; saved product evidence can be refreshed from Onboarding.');}
}
