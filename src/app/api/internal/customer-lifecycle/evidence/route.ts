import { lifecycleAuthorized,readCustomerMilestones,boundedLifecycleBody } from '@/lib/customer-lifecycle';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!lifecycleAuthorized(request)) return Response.json({code:'UNAUTHORIZED'},{status:401});
 try{
  const raw=await boundedLifecycleBody(request);
  const b=JSON.parse(raw);
  if(Object.keys(b).some(k=>!['email','since'].includes(k)) || typeof b.email!=='string' || b.email.length>254 ||
   !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) || !Number.isFinite(Date.parse(b.since))) return Response.json({code:'INVALID_REQUEST'},{status:400});
  return Response.json(await readCustomerMilestones(b.email.trim().toLowerCase(),new Date(b.since)),{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({code:'PRODUCT_EVIDENCE_UNAVAILABLE'},{status:503});}
}
