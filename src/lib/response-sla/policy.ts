import type { PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';

export const DEFAULT_RESPONSE_SLA_POLICY = Object.freeze({ enabled: true,
  criticalMinutes: 15, highMinutes: 60, mediumMinutes: 240, lowMinutes: 1440,
  unknownMinutes: 240, dueSoonPercent: 75, breachEscalationEnabled: true, revision: 0 });
export type ResponseSLAPolicyValues = Omit<typeof DEFAULT_RESPONSE_SLA_POLICY, 'revision'>;

export async function getResponseSLAPolicy(userId: string, db: PrismaClient = prisma) {
  if (!userId) throw new TypeError('Authenticated tenant required');
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new Error('Tenant not found');
  return await db.responseSLAPolicy.findUnique({ where: { userId } }) ??
    { id: null, userId, ...DEFAULT_RESPONSE_SLA_POLICY };
}

export function validateResponseSLAPolicy(value: unknown): ResponseSLAPolicyValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('SLA policy required');
  const row = value as Record<string, unknown>;
  const keys = ['enabled', 'criticalMinutes', 'highMinutes', 'mediumMinutes', 'lowMinutes',
    'unknownMinutes', 'dueSoonPercent', 'breachEscalationEnabled'];
  if (Object.keys(row).some(key => !keys.includes(key))) throw new TypeError('Unknown SLA policy field');
  if (typeof row.enabled !== 'boolean' || typeof row.breachEscalationEnabled !== 'boolean')
    throw new TypeError('Invalid SLA switch');
  for (const key of keys.slice(1, 6)) {
    const duration = row[key];
    if (!Number.isInteger(duration) || (duration as number) < 1 || (duration as number) > 10_080)
      throw new TypeError(`${key} must be 1–10080 minutes`);
  }
  if (!Number.isInteger(row.dueSoonPercent) || (row.dueSoonPercent as number) < 50 || (row.dueSoonPercent as number) > 95)
    throw new TypeError('Due-soon percentage must be 50–95');
  return row as ResponseSLAPolicyValues;
}

export async function saveResponseSLAPolicy(userId: string, value: unknown, db: PrismaClient = prisma) {
  const data = validateResponseSLAPolicy(value);
  await getResponseSLAPolicy(userId, db);
  return db.responseSLAPolicy.upsert({ where: { userId }, create: { userId, ...data },
    update: { ...data, revision: { increment: 1 } } });
}
