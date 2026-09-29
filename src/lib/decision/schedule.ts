import { after } from 'next/server';
import { triageInboundSignal } from './triage';
import { canAutomaticallyTriage } from './rollout';
import { runAutopilot } from '../automation/actions';
import { syncResponseSLAForDecision } from '../response-sla/service';
import { assessRevenueAtRisk } from '../revenue-risk/service';
import { prisma } from '../prisma';
import { hasFeatureAccess, normalizeFrameLeadsTier } from '../entitlements';

async function currentTierForUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true, email: true } });
  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL?.trim().toLowerCase();
  return adminEmail && user?.email.trim().toLowerCase() === adminEmail ? 'ENTERPRISE' : normalizeFrameLeadsTier(user?.tier);
}

/** Best-effort post-response trigger. Inbound persistence is already committed. */
export function scheduleInboundDecisions(userId: string, signalIds: string[],
  deps: { enqueue?: typeof after; triage?: typeof triageInboundSignal; tier?: () => Promise<string> } = {}) {
  if (!canAutomaticallyTriage()) return;
  const unique = [...new Set(signalIds.filter(Boolean))];
  if (!userId || !unique.length) return;
  try {
    (deps.enqueue ?? after)(async () => {
      const tier = deps.tier ? await deps.tier() : await currentTierForUser(userId);
      if (!hasFeatureAccess(tier, 'DECISION_ENGINE')) return;
      let next = 0;
      async function worker() {
        while (next < unique.length) {
          const signalId = unique[next++];
          try {
            const result = await (deps.triage ?? triageInboundSignal)({ userId, signalId });
            if (result.decision && !deps.triage && hasFeatureAccess(tier, 'REVENUE_RISK')) {
              try { await runAutopilot({ userId, decisionId: result.decision.id }); }
              finally {
                try { await assessRevenueAtRisk({ userId, decisionId: result.decision.id }); }
                catch { console.error('Post-ingestion risk assessment unavailable; SLA may use unknown duration'); }
                await syncResponseSLAForDecision({ userId, decisionId: result.decision.id });
              }
            }
          }
          catch { console.error('Post-ingestion decision triage failed; inbound remains saved'); }
        }
      }
      await Promise.all([worker(), worker()]);
    });
  } catch {
    // Scheduling support can be unavailable in non-Next callers; manual idempotent triage remains available.
    console.error('Post-ingestion decision scheduling unavailable; inbound remains saved');
  }
}
