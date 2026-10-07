import {verifyVercelOidcToken} from '@vercel/oidc';
import {lifecycleAuthorized,boundedLifecycleBody} from '@/lib/customer-lifecycle';
import {readAcceptancePreflight,runControlledAcceptance,B6_ACCEPTANCE_CODES} from '@/lib/decision/b6-controlled-acceptance';
export const runtime='nodejs';
export const maxDuration=300;
async function authorized(request:Request){
 if(!lifecycleAuthorized(request))return 'PRODUCT_BEARER_REJECTED';
 const token=request.headers.get('x-brandbrain-b6-oidc-token');if(!token||token.length>12000)return 'PRODUCT_OIDC_REJECTED';
 try{await verifyVercelOidcToken(token,{projectId:'prj_d5280Dac0xfO0i9arCpvAs3k7EHV',ownerId:'team_jX56ywj76j7NPQT2CaY19x6u',environment:'production',issuer:'https://oidc.vercel.com/frameleads',audience:'https://vercel.com/frameleads',subject:'owner:frameleads:project:brandbrain:environment:production'});return null;}catch{return 'PRODUCT_OIDC_REJECTED';}
}
export async function GET(request:Request){
 const rejection=await authorized(request);if(rejection)return Response.json({code:rejection},{status:401});
 try{return Response.json(await readAcceptancePreflight(),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({code:'PRODUCT_PREFLIGHT_FAILED'},{status:409});}
}
export async function POST(request:Request){
 const rejection=await authorized(request);if(rejection)return Response.json({code:rejection},{status:401});
 let input:any;
 try{
  input=JSON.parse(await boundedLifecycleBody(request));
  const keys=['B6_ACCEPTANCE_RUN','B6_ACCEPTANCE_CUSTOMER_EMAIL','B6_CONTROLLED_PROSPECT_EMAIL','B6_REPLY_MESSAGE_ID','B6_GMAIL_APP_PASSWORD'];
  if(!input||Object.keys(input).length!==5||Object.keys(input).some(k=>!keys.includes(k)))return Response.json({code:'INVALID_REQUEST'},{status:400});
  return Response.json(await runControlledAcceptance(input),{headers:{'Cache-Control':'no-store'}});
 }catch(error){const code=error instanceof Error&&B6_ACCEPTANCE_CODES.includes(error.message)?error.message:'PRODUCT_PREFLIGHT_FAILED';
  return Response.json({code,outcome:'VERIFY_DURABLE_STATE_NO_RETRY'},{status:409,headers:{'Cache-Control':'no-store'}});}
 finally{if(input)input.B6_GMAIL_APP_PASSWORD='';}
}
