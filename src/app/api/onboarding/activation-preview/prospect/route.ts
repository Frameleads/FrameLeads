import { verifiedCustomerUser } from '@/lib/customer-session';
import { validMutationOrigin } from '@/lib/automation/auth';
import { boundedLifecycleBody, projectCustomerProgress } from '@/lib/customer-lifecycle';
import { importPreviewProspect } from '@/lib/decision/activation-preview-setup';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!validMutationOrigin(request)) return Response.json({ code: 'ORIGIN_REJECTED' }, { status: 403 });
  const user = await verifiedCustomerUser();
  if (user?.tier !== 'MICRO_PILOT') return Response.json({ code: 'MICRO_PILOT_REQUIRED' }, { status: 403 });
  try {
    const body = JSON.parse(await boundedLifecycleBody(request));
    if (!body || Object.keys(body).length !== 1 || !('email' in body)) return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
    const lead = await importPreviewProspect(user.id, body.email);
    await projectCustomerProgress(user.id);
    return Response.json({ status: 'IMPORTED', leadId: lead.id, prospectId: lead.prospectId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ code: 'CONTROLLED_IMPORT_UNAVAILABLE' }, { status: 409 }); }
}
