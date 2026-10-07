import { verifiedCustomerUser } from '@/lib/customer-session';
import { prisma } from '@/lib/prisma';
import { syncCustomerLifecycle,boundedLifecycleBody } from '@/lib/customer-lifecycle';
import { validMutationOrigin } from '@/lib/automation/auth';
export const runtime='nodejs';
export async function POST(request:Request){
 if(!validMutationOrigin(request)) return Response.json({code:'ORIGIN_REJECTED'},{status:403});
 const user=await verifiedCustomerUser();
 if(!user) return Response.json({code:'UNAUTHORIZED'},{status:401});
 try{
  const raw=await boundedLifecycleBody(request);if(raw.trim()!=='{}') return Response.json({code:'INVALID_REQUEST'},{status:400});
  const row=await prisma.user.findUniqueOrThrow({where:{id:user.id},select:{email:true}});
  return Response.json(await syncCustomerLifecycle(row.email.trim().toLowerCase()),{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({code:'ONBOARDING_UNAVAILABLE'},{status:503});}
}
