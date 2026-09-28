import { AutomationMode, CampaignAutomationMode, type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';

export const DEFAULT_AUTOMATION_POLICY = {
  defaultMode: AutomationMode.HUMAN_APPROVAL,
  fallbackMode: AutomationMode.HUMAN_APPROVAL,
  autopilotEnabled: false,
  autoExecutionDisabled: true,
  autopilotMinConfidence: 90,
  maxAutoSendsPerDay: 20,
  revision: 0,
} as const;

export function automaticExecutionRolloutEnabled(value = process.env.AUTOMATION_EXECUTION_ENABLED) {
  return value === 'true';
}

export async function getAutomationPolicy(userId: string, db: PrismaClient = prisma) {
  if (!userId) throw new TypeError('Authenticated tenant required');
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new Error('Tenant not found');
  return (await db.automationPolicy.findUnique({ where: { userId } })) ?? { id: null, userId, ...DEFAULT_AUTOMATION_POLICY };
}

export type AutomationPolicyUpdate = {
  defaultMode: AutomationMode; fallbackMode: AutomationMode; autopilotEnabled: boolean;
  autoExecutionDisabled: boolean; autopilotMinConfidence: number; maxAutoSendsPerDay: number;
};
export function validateAutomationPolicy(input: unknown): AutomationPolicyUpdate {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Policy object required');
  const row = input as Record<string, unknown>;
  const keys = ['defaultMode','fallbackMode','autopilotEnabled','autoExecutionDisabled','autopilotMinConfidence','maxAutoSendsPerDay'];
  if (Object.keys(row).some(key => !keys.includes(key))) throw new TypeError('Unknown policy field');
  if (!Object.values(AutomationMode).includes(row.defaultMode as AutomationMode)) throw new TypeError('Invalid default mode');
  if (!([AutomationMode.HUMAN_APPROVAL, AutomationMode.MANDATORY_ESCALATION] as AutomationMode[]).includes(row.fallbackMode as AutomationMode))
    throw new TypeError('Fallback cannot be Autopilot');
  if (typeof row.autopilotEnabled !== 'boolean' || typeof row.autoExecutionDisabled !== 'boolean') throw new TypeError('Invalid switch');
  if (!Number.isInteger(row.autopilotMinConfidence) || (row.autopilotMinConfidence as number) < 70 || (row.autopilotMinConfidence as number) > 100)
    throw new TypeError('Confidence must be 70–100');
  if (!Number.isInteger(row.maxAutoSendsPerDay) || (row.maxAutoSendsPerDay as number) < 1 || (row.maxAutoSendsPerDay as number) > 100)
    throw new TypeError('Daily automatic send limit must be 1–100');
  return row as AutomationPolicyUpdate;
}

export async function saveAutomationPolicy(userId: string, input: unknown, db: PrismaClient = prisma) {
  const values = validateAutomationPolicy(input);
  await getAutomationPolicy(userId, db);
  return db.automationPolicy.upsert({ where: { userId }, create: { userId, ...values },
    update: { ...values, revision: { increment: 1 } } });
}

export async function setLeadListAutomationOverride(input: { userId: string; leadListId: string;
  mode: CampaignAutomationMode }, db: PrismaClient = prisma) {
  if (!Object.values(CampaignAutomationMode).includes(input.mode)) throw new TypeError('Invalid override mode');
  const list = await db.leadList.findFirst({ where: { id: input.leadListId, userId: input.userId }, select: { id: true } });
  if (!list) throw new Error('Lead list not found for tenant');
  return db.automationCampaignOverride.upsert({ where: { userId_leadListId: { userId: input.userId, leadListId: list.id } },
    create: { userId: input.userId, leadListId: list.id, mode: input.mode }, update: { mode: input.mode } });
}

export async function setProspectHold(input: { userId: string; prospectId: string; active: boolean;
  reason?: string }, db: PrismaClient = prisma) {
  const prospect = await db.prospect.findUnique({ where: { userId_id: { userId: input.userId, id: input.prospectId } }, select: { id: true } });
  if (!prospect) throw new Error('Prospect not found for tenant');
  const reason = input.reason?.replace(/\s+/g, ' ').trim().slice(0, 360) || '';
  if (input.active && !reason) throw new TypeError('Hold reason required');
  const existing = await db.prospectHold.findUnique({ where: { userId_prospectId: { userId: input.userId, prospectId: prospect.id } } });
  if (!input.active && !existing) throw new Error('No hold to release');
  if (!input.active && !existing?.active) return existing;
  return db.prospectHold.upsert({ where: { userId_prospectId: { userId: input.userId, prospectId: prospect.id } },
    create: { userId: input.userId, prospectId: prospect.id, active: true, reason },
    update: input.active ? { active: true, reason, releasedAt: null, releasedByUserId: null } :
      { active: false, releasedAt: new Date(), releasedByUserId: input.userId } });
}
