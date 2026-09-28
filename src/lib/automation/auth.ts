import { cookies } from 'next/headers';
import { prisma } from '../prisma';
import { resolveScoutUser } from '../scout-data';

/** Central authorization seam until FrameLeads has a tenant-member role model. */
export async function authenticatedAutomationUserId() {
  const jar = await cookies();
  return (await resolveScoutUser(prisma, jar.get('frameleads_session')?.value,
    jar.get('user_email')?.value))?.id ?? null;
}

export function validMutationOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}
