import { lifecycleAuthorized, boundedLifecycleBody, syncCustomerLifecycle } from '@/lib/customer-lifecycle';
export const runtime = 'nodejs';
export const maxDuration = 30;
/** Authenticated operator refresh; milestones are still derived by the product evidence boundary. */
export async function POST(request: Request) {
  if (!lifecycleAuthorized(request)) return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  try {
    const body = JSON.parse(await boundedLifecycleBody(request));
    if (!body || Object.keys(body).length !== 1 || typeof body.email !== 'string' || body.email.length > 254 ||
      body.email !== body.email.trim().toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
      return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
    return Response.json(await syncCustomerLifecycle(body.email), { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ code: 'LIFECYCLE_SYNC_UNAVAILABLE' }, { status: 503 }); }
}
