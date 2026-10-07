// Operator CLI only. No .env loading, UI, database inserts, secret printing or retry loop.
// CommonJS matches this repository's package mode and avoids Node's ESM reparse warning.
const b6SafeCodes=new Set(['LOCAL_CONFIG_FAILED','LOCAL_BRANDBRAIN_TRANSPORT_FAILED','BRANDBRAIN_RESPONSE_INVALID',
 'UNAUTHORIZED','ORIGIN_REJECTED','INVALID_ACCEPTANCE_INPUT','NUDGE_SEND_GATE_MUST_BE_FALSE','BRANDBRAIN_SNAPSHOT_FAILED',
 'ACTIVATION_ALREADY_RECORDED','BRANDBRAIN_READBACK_FAILED','PRODUCT_TRANSPORT_FAILED','PRODUCT_TRANSPORT_401','PRODUCT_TRANSPORT_403',
 'PRODUCT_TRANSPORT_409','PRODUCT_TRANSPORT_429','PRODUCT_TRANSPORT_500','PRODUCT_TRANSPORT_502','PRODUCT_TRANSPORT_503','PRODUCT_TRANSPORT_504',
 'PRODUCT_BEARER_REJECTED','PRODUCT_OIDC_REJECTED','PRODUCT_PREFLIGHT_FAILED','CUSTOMER_ENROLLMENT_FAILED',
 'CONTROLLED_PROSPECT_IMPORT_FAILED','GMAIL_PROVIDER_FAILED','PROVIDER_RECEIPT_PERSIST_FAILED','GOVERNED_DECISION_FAILED',
 'DECISION_TRACE_VERIFICATION_FAILED','ACTIVATION_READBACK_FAILED','ACCEPTANCE_STOPPED_DO_NOT_RETRY']);
async function runAcceptance(env:NodeJS.ProcessEnv=process.env){
 const keys=['B6_ACCEPTANCE_RUN','B6_ACCEPTANCE_CUSTOMER_EMAIL','B6_CONTROLLED_PROSPECT_EMAIL','B6_REPLY_MESSAGE_ID','B6_GMAIL_APP_PASSWORD'] as const;
 const input=Object.fromEntries(keys.map(key=>[key,env[key]]));
 delete env.B6_GMAIL_APP_PASSWORD;
 let stage='LOCAL_CONFIG_FAILED';
 try{
  if(input.B6_ACCEPTANCE_RUN!=='true')throw new Error('B6_ACCEPTANCE_RUN must be exactly true.');
  if(input.B6_ACCEPTANCE_CUSTOMER_EMAIL!=='akramwalid628@gmail.com'||input.B6_CONTROLLED_PROSPECT_EMAIL!=='akram@frameleads.io')throw new Error('Only the approved controlled identities are permitted.');
  if(!input.B6_REPLY_MESSAGE_ID||!input.B6_GMAIL_APP_PASSWORD)throw new Error('Temporary provider inputs are required. Never paste the password into chat.');
  const secret=env.OUTBOUND_DISPATCH_SECRET,bypass=env.BRANDBRAIN_VERCEL_BYPASS;
  if(!secret||!bypass)throw new Error('Existing operator authentication must be supplied by the authorized credential store.');
  stage='LOCAL_BRANDBRAIN_TRANSPORT_FAILED';
  const response=await fetch('https://brandbrain-pi.vercel.app/api/internal/customer-onboarding/acceptance',{
   method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+secret,origin:'https://brandbrain-pi.vercel.app','x-vercel-protection-bypass':bypass},
   body:JSON.stringify(input),signal:AbortSignal.timeout(320000)});
  stage='BRANDBRAIN_RESPONSE_INVALID';
  const text=await response.text();if(text.length>4096)throw new Error(stage);
  const result=JSON.parse(text);
  if(!response.ok||result.status!=='ACTIVATED')throw Object.assign(new Error(b6SafeCodes.has(result.code)?result.code:'ACCEPTANCE_STOPPED_DO_NOT_RETRY'),{httpStatus:response.status});
  // Allowlist output. Never echo request bodies or arbitrary upstream responses.
  console.log(JSON.stringify({status:result.status,decisionId:result.decisionId,traceId:result.traceId,onboardingId:result.onboardingId,activationEvidenceCount:result.activationEvidenceCount,emailsSent:result.emailsSent}));
 }catch(error){const e=error as {message?:string;httpStatus?:number};throw Object.assign(new Error(e.message&&b6SafeCodes.has(e.message)?e.message:stage),{httpStatus:e.httpStatus});}
 finally{input.B6_GMAIL_APP_PASSWORD='';for(const key of keys)delete env[key];}
}
module.exports={runAcceptance};
if(require.main===module){
 runAcceptance().catch(error=>{console.log(JSON.stringify({status:'STOPPED',code:b6SafeCodes.has(error.message)?error.message:'ACCEPTANCE_STOPPED_DO_NOT_RETRY',
  httpStatus:Number.isInteger(error.httpStatus)?error.httpStatus:undefined,outcome:'VERIFY_DURABLE_STATE_NO_RETRY'}));process.exitCode=1;});
}
