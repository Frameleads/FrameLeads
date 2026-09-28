import { after } from 'next/server';
import { triageInboundSignal } from './triage';
import { canAutomaticallyTriage } from './rollout';
import { runAutopilot } from '../automation/actions';
import { syncResponseSLAForDecision } from '../response-sla/service';
import { assessRevenueAtRisk } from '../revenue-risk/service';

/** Best-effort post-response trigger. Inbound persistence is already committed. */
export function scheduleInboundDecisions(userId: string, signalIds: string[],
  deps: { enqueue?: typeof after; triage?: typeof triageInboundSignal } = {}) {
  if (!canAutomaticallyTriage()) return;
  const unique = [...new Set(signalIds.filter(Boolean))];
  if (!userId || !unique.length) return;
  try {
    (deps.enqueue ?? after)(async () => {
      let next = 0;
      async function worker() {
        while (next < unique.length) {
          const signalId = unique[next++];
          try {
            const result = await (deps.triage ?? triageInboundSignal)({ userId, signalId });
            if (result.decision && !deps.triage) {
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
