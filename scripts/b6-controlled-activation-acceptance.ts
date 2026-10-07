// Operator CLI only. No .env loading, UI, database inserts, secret printing or retry loop.
import {pathToFileURL} from 'node:url';
export async function runAcceptance(env:NodeJS.ProcessEnv=process.env){
 const keys=['B6_ACCEPTANCE_RUN','B6_ACCEPTANCE_CUSTOMER_EMAIL','B6_CONTROLLED_PROSPECT_EMAIL','B6_REPLY_MESSAGE_ID','B6_GMAIL_APP_PASSWORD'] as const;
 const input=Object.fromEntries(keys.map(key=>[key,env[key]]));
 delete env.B6_GMAIL_APP_PASSWORD;
 try{
  if(input.B6_ACCEPTANCE_RUN!=='true')throw new Error('B6_ACCEPTANCE_RUN must be exactly true.');
  if(input.B6_ACCEPTANCE_CUSTOMER_EMAIL!=='akramwalid628@gmail.com'||input.B6_CONTROLLED_PROSPECT_EMAIL!=='akram@frameleads.io')throw new Error('Only the approved controlled identities are permitted.');
  if(!input.B6_REPLY_MESSAGE_ID||!input.B6_GMAIL_APP_PASSWORD)throw new Error('Temporary provider inputs are required. Never paste the password into chat.');
  const secret=env.OUTBOUND_DISPATCH_SECRET,bypass=env.BRANDBRAIN_VERCEL_BYPASS;
  if(!secret||!bypass)throw new Error('Existing operator authentication must be supplied by the authorized credential store.');
  const response=await fetch('https://brandbrain-pi.vercel.app/api/internal/customer-onboarding/acceptance',{
   method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+secret,origin:'https://brandbrain-pi.vercel.app','x-vercel-protection-bypass':bypass},
   body:JSON.stringify(input),signal:AbortSignal.timeout(320000)});
  const result=await response.json();
  if(!response.ok||result.status!=='ACTIVATED')throw new Error('Acceptance stopped. Inspect durable state before any further execution.');
  // Allowlist output. Never echo request bodies or arbitrary upstream responses.
  console.log(JSON.stringify({status:result.status,decisionId:result.decisionId,traceId:result.traceId,onboardingId:result.onboardingId,activationEvidenceCount:result.activationEvidenceCount,emailsSent:result.emailsSent}));
 }finally{input.B6_GMAIL_APP_PASSWORD='';for(const key of keys)delete env[key];}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 runAcceptance().catch(()=>{console.error('B6 acceptance stopped. No automatic retry. Inspect durable state with the operator.');process.exitCode=1;});
}
