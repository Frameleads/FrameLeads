import {
  MembershipFilteredOutError,
  UnrecognizedWhopProductError,
  type WhopSubscription,
} from "./whop-subscription";

type RefreshInput = {
  userId: string;
  whopUserId: string;
  accessToken: string;
  currentTier: string;
  currentMonthlyQuota: number;
};
type CacheEntry = {
  tier: WhopSubscription["tier"] | "INACTIVE";
  monthlyQuota: number;
  checkedAt: number;
  refreshAt: number;
  staleUntil: number;
  validUntil?: number;
};
type Dependencies = {
  verify: (accessToken: string, whopUserId: string) => Promise<WhopSubscription>;
  persist: (userId: string, entitlement: { tier: string; monthlyQuota: number }) => Promise<void>;
  now?: () => number;
  cacheTtlMs?: number;
  outageGraceMs?: number;
};

const NEGATIVE_CACHE_MS = 15_000;

/** Process-local freshness cache; never persists provider tokens or membership payloads. */
export function createWhopEntitlementRefresher(dependencies: Dependencies) {
  const cache = new Map<string, CacheEntry>();
  const now = dependencies.now ?? Date.now;
  const cacheTtlMs = dependencies.cacheTtlMs ?? 30_000;
  const outageGraceMs = dependencies.outageGraceMs ?? 120_000;

  async function persist(userId: string, tier: string, monthlyQuota: number) {
    try {
      await dependencies.persist(userId, { tier, monthlyQuota });
    } catch {
      // The request still uses the freshly verified value; the next request retries persistence.
    }
  }

  return {
    invalidate(whopUserId: string) {
      cache.delete(whopUserId);
    },
    async refresh(input: RefreshInput): Promise<string> {
      const currentTime = now();
      const existing = cache.get(input.whopUserId);
      if (existing && currentTime < existing.refreshAt && (existing.validUntil === undefined || currentTime < existing.validUntil)) {
        return existing.tier;
      }

      try {
        const subscription = await dependencies.verify(input.accessToken, input.whopUserId);
        const entitlement = { tier: subscription.tier, monthlyQuota: subscription.monthlyQuota };
        if (input.currentTier !== entitlement.tier || input.currentMonthlyQuota !== entitlement.monthlyQuota) {
          await persist(input.userId, entitlement.tier, entitlement.monthlyQuota);
        }
        const validUntil = subscription.validUntil;
        cache.set(input.whopUserId, {
          ...entitlement,
          checkedAt: currentTime,
          refreshAt: Math.min(currentTime + cacheTtlMs, validUntil ?? Number.POSITIVE_INFINITY),
          staleUntil: Math.min(currentTime + outageGraceMs, validUntil ?? Number.POSITIVE_INFINITY),
          validUntil,
        });
        return entitlement.tier;
      } catch (error) {
        if (error instanceof MembershipFilteredOutError || error instanceof UnrecognizedWhopProductError) {
          cache.set(input.whopUserId, {
            tier: "INACTIVE", monthlyQuota: 0, checkedAt: currentTime,
            refreshAt: currentTime + NEGATIVE_CACHE_MS, staleUntil: currentTime + NEGATIVE_CACHE_MS,
          });
          if (input.currentTier !== "INACTIVE" || input.currentMonthlyQuota !== 0) {
            await persist(input.userId, "INACTIVE", 0);
          }
          return "INACTIVE";
        }

        if (existing && currentTime < existing.staleUntil && (existing.validUntil === undefined || currentTime < existing.validUntil)) {
          // A short bounded outage grace preserves a recently verified buyer,
          // but it cannot cross the last known billing-period end.
          cache.set(input.whopUserId, { ...existing, refreshAt: currentTime + 5_000 });
          return existing.tier;
        }
        return "INACTIVE";
      }
    },
  };
}
