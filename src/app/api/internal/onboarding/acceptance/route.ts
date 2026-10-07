import {verifyVercelOidcToken} from '@vercel/oidc';
import {lifecycleAuthorized,boundedLifecycleBody} from '@/lib/customer-lifecycle';
import {readAcceptancePreflight,runControlledAcceptance,B6_ACCEPTANCE_CODES} from '@/lib/decision/b6-controlled-acceptance';
import {diagnosePersistedSignal,resumePersistedSignal,B6_SIGNAL} from '@/lib/decision/b6-persisted-signal';
import {readPendingRecoveryPreflight,recoverPendingDecision} from '@/lib/decision/b6-pending-recovery';
import {runSyntheticProviderProbe} from '@/lib/decision/b6-provider-probe';
export const runtime='nodejs';
export const maxDuration=300;
async function authorized(request:Request){
 if(!lifecycleAuthorized(request))return 'PRODUCT_BEARER_REJECTED';
 const token=request.headers.get('x-brandbrain-b6-oidc-token');if(!token||token.length>12000)return 'PRODUCT_OIDC_REJECTED';
 try{await verifyVercelOidcToken(token,{projectId:'prj_d5280Dac0xfO0i9arCpvAs3k7EHV',ownerId:'team_jX56ywj76j7NPQT2CaY19x6u',environment:'production',issuer:'https://oidc.vercel.com/frameleads',audience:'https://vercel.com/frameleads',subject:'owner:frameleads:project:brandbrain:environment:production'});return null;}catch{return 'PRODUCT_OIDC_REJECTED';}
}
export async function GET(request:Request){
 const rejection=await authorized(request);if(rejection)return Response.json({code:rejection},{status:401});
 try{const mode=new URL(request.url).searchParams.get('mode');return Response.json(mode==='recovery-preflight'?await readPendingRecoveryPreflight():mode==='diagnostic'?await diagnosePersistedSignal():await readAcceptancePreflight(),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({code:'PRODUCT_PREFLIGHT_FAILED'},{status:409});}
}
export async function POST(request:Request){
 const rejection=await authorized(request);if(rejection)return Response.json({code:rejection},{status:401});
 let input:any;
 try{
  input=JSON.parse(await boundedLifecycleBody(request));
  if(input?.mode==='SYNTHETIC_PROVIDER_PROBE'&&Object.keys(input).length===2)return Response.json(await runSyntheticProviderProbe(input.probe),{headers:{'Cache-Control':'no-store'}});
  if(input?.mode==='RECOVER_PENDING_DECISION')return Response.json(await recoverPendingDecision(input),{headers:{'Cache-Control':'no-store'}});
  if(input?.mode==='RESUME_PERSISTED_SIGNAL'){
   if(Object.keys(input).length!==2||input.signalId!==B6_SIGNAL)return Response.json({code:'INVALID_REQUEST'},{status:400});
   return Response.json(await resumePersistedSignal(),{headers:{'Cache-Control':'no-store'}});
  }
  const keys=['B6_ACCEPTANCE_RUN','B6_ACCEPTANCE_CUSTOMER_EMAIL','B6_CONTROLLED_PROSPECT_EMAIL','B6_REPLY_MESSAGE_ID','B6_GMAIL_APP_PASSWORD'];
  if(!input||Object.keys(input).length!==5||Object.keys(input).some(k=>!keys.includes(k)))return Response.json({code:'INVALID_REQUEST'},{status:400});
  return Response.json(await runControlledAcceptance(input),{headers:{'Cache-Control':'no-store'}});
 }catch(error){const code=error instanceof Error&&[...B6_ACCEPTANCE_CODES,'PERSISTED_SIGNAL_PREFLIGHT_FAILED','FIXED_PENDING_RECOVERY_REQUIRED',
  'RECOVERY_PREFLIGHT_FAILED','RECOVERY_EVIDENCE_REQUIRED','RECOVERY_OWNERSHIP_REQUIRED','RECOVERY_ONBOARDING_REQUIRED','RECOVERY_CONTEXT_CHANGED',
  'RECOVERY_TRACE_VERIFICATION_FAILED','RECOVERY_ACTIVATION_FAILED','RECOVERY_POLICY_VERIFICATION_FAILED'].includes(error.message)?error.message:'PRODUCT_PREFLIGHT_FAILED';
  return Response.json({code,outcome:'VERIFY_DURABLE_STATE_NO_RETRY'},{status:409,headers:{'Cache-Control':'no-store'}});}
 finally{if(input)input.B6_GMAIL_APP_PASSWORD='';}
}
