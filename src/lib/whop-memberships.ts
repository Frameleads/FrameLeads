import type { VerifiedAllowancePeriod } from './allowance-period';
import { getWhopApiOrigin } from "./whop-environment";
import {
  MembershipFilteredOutError,
  resolveWhopSubscription,
  type WhopSubscription,
} from "./whop-subscription";

type WhopMembership = {
  id?: string;
  status?: string;
  valid?: boolean;
  user_id?: string;
  user?: string | { id?: string } | null;
  company_id?: string;
  company?: string | { id?: string } | null;
  account?: string | { id?: string } | null;
  plan_id?: string;
  cancel_at_period_end?: boolean;
  billing_period_days?: number | null;
  renewal_period_start?: string | number | null;
  renewal_period_end?: string | number | null;
  current_period_start?: string | number | null;
  current_period_end?: string | number | null;
  expires_at?: string | number | null;
  product?: { id?: string; name?: string; title?: string; route?: string; metadata?: unknown };
  plan?: { billing_period?: number | null; id?: string; name?: string; title?: string; metadata?: unknown };
  metadata?: unknown;
};

type WhopMembershipList = {
  data?: WhopMembership[];
  page_info?: { end_cursor?: string | null; has_next_page?: boolean };
};

const DEFAULT_COMPANY_ID = "biz_RSQW7xARXYAQke";
const PAGE_SIZE = 50;
const MAX_MEMBERSHIP_PAGES = 10;

function timestamp(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1_000_000_000_000 ? value * 1000 : value;
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const parsed = Number.isFinite(numeric) ? (numeric < 1_000_000_000_000 ? numeric * 1000 : numeric) : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function membershipPeriodEnd(membership: WhopMembership): number | null {
  return timestamp(membership.renewal_period_end ?? membership.expires_at);
}

/** Whop's current status plus the current billing boundary is authoritative. */
export function membershipCurrentlyEntitled(membership: WhopMembership, now = Date.now()): boolean {
  const status = membership.status?.toLowerCase();
  const end = membershipPeriodEnd(membership);
  if (membership.valid === false || (end !== null && end <= now)) return false;

  if (status === "canceling") {
    return membership.cancel_at_period_end === true && end !== null && end > now;
  }
  if (status === "active") {
    return membership.cancel_at_period_end !== true || (end !== null && end > now);
  }
  if (status === "trialing" || status === "trial") return true;
  // Keep older Whop representations that were previously accepted. Explicit
  // expiry and Whop's invalid statuses still take precedence above/below.
  if (status === "completed" || status === "valid" || status === "free") return true;
  return false; // past_due, canceled, expired, unresolved, drafted, and unknown
}

function relationId(value: string | { id?: string } | null | undefined): string | undefined {
  return typeof value === "string" ? value : value?.id;
}

/** Normalize both Whop membership response shapes without changing provider values. */
function normalizeMembership(membership: WhopMembership): WhopMembership {
  const companyId = membership.company_id || relationId(membership.company) || relationId(membership.account);
  const planId = membership.plan?.id || membership.plan_id;
  return {
    ...membership,
    ...(companyId ? { company_id: companyId } : {}),
    ...(planId && !membership.plan?.id
      ? { plan: { id: planId, billing_period: membership.billing_period_days } }
      : {}),
    renewal_period_start: membership.renewal_period_start ?? membership.current_period_start,
    renewal_period_end: membership.renewal_period_end ?? membership.current_period_end,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function verifyWhopSubscription(
  accessToken: string,
  whopUserId: string,
  request: typeof fetch = fetch,
  allowanceReview?: { planId?: string; planIds?: string[] },
): Promise<WhopSubscription> {
  const companyId = process.env.WHOP_COMPANY_ID || DEFAULT_COMPANY_ID;
  const membershipsUrl = new URL(getWhopApiOrigin() + "/api/v1/memberships");
  membershipsUrl.searchParams.append("expand", "product");
  membershipsUrl.searchParams.append("expand", "plan");
  membershipsUrl.searchParams.set("account_id", companyId);
  membershipsUrl.searchParams.set("user_id", "me");
  membershipsUrl.searchParams.set("first", String(PAGE_SIZE));

  const memberships: WhopMembership[] = [];
  const cursors = new Set<string>();
  let after: string | null = null;

  for (let page = 0; page < MAX_MEMBERSHIP_PAGES; page++) {
    if (after) membershipsUrl.searchParams.set("after", after);
    else membershipsUrl.searchParams.delete("after");

    let response: Response;
    try {
      response = await request(membershipsUrl, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new Error("Whop membership API request could not complete");
    }
    if (!response.ok) throw new Error(`Whop membership verification failed (${response.status})`);

    let payload: WhopMembershipList;
    try {
      const raw = await response.text();
      if (raw.length > 2_000_000) throw new Error("Membership response exceeded size limit");
      payload = JSON.parse(raw) as WhopMembershipList;
    } catch {
      throw new Error("Whop membership response was invalid");
    }
    if (!Array.isArray(payload.data)) throw new Error("Whop membership response was malformed");
    memberships.push(...payload.data.map(normalizeMembership));

    if (payload.page_info?.has_next_page !== true) break;
    const next = payload.page_info.end_cursor;
    if (typeof next !== "string" || !next || cursors.has(next)) {
      throw new Error("Whop membership pagination was incomplete");
    }
    cursors.add(next);
    after = next;
    if (page === MAX_MEMBERSHIP_PAGES - 1) throw new Error("Whop membership history exceeded the verification limit");
  }

  const currentMemberships = memberships.filter((membership) => {
    const userId = membership.user_id || relationId(membership.user);
    const membershipCompanyId = membership.company_id || relationId(membership.company);
    return userId === whopUserId
      && membershipCompanyId === companyId
      && membershipCurrentlyEntitled(membership);
  });

  if (currentMemberships.length === 0) throw new MembershipFilteredOutError(memberships.length);
  const subscription = resolveWhopSubscription(currentMemberships);
  const periodEnds = currentMemberships
    .map(membershipPeriodEnd)
    .filter((value): value is number => value !== null);
  // Revalidate at the earliest known billing boundary. A cancelled membership
  // remains entitled through that boundary, but no local cache crosses it.
  // Only enrolled usage requests opt into the additional read. Normal access checks
  // keep their existing request contract. Never substitute an unreviewed plan.
  if (allowanceReview) {
    const selected = currentMemberships.filter(m => {
      try { return resolveWhopSubscription(m).tier === subscription.tier; } catch { return false; }
    });
    if (selected.length === 1 && selected[0].plan?.id && [allowanceReview.planId, ...(allowanceReview.planIds || [])].includes(selected[0].plan.id) &&
        selected[0].billing_period_days == null && selected[0].plan.billing_period == null) {
      const reviewedPlanId = selected[0].plan!.id!;
      const response = await request(getWhopApiOrigin() + '/api/v1/plans/' + encodeURIComponent(reviewedPlanId), {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Allowance plan interval could not be verified');
      const raw = await response.text();
      if (raw.length > 100000) throw new Error('Allowance plan response exceeded limit');
      const parsed = JSON.parse(raw), plan = parsed.data || parsed;
      if (plan.id !== reviewedPlanId) throw new Error('Allowance plan identity mismatch');
      selected[0].plan = { ...selected[0].plan, billing_period: plan.billing_period };
    }
  }
  const allowancePeriod = selectAllowancePeriod(currentMemberships, subscription.tier, whopUserId, companyId);
  return { ...subscription, validUntil: periodEnds.length ? Math.min(...periodEnds) : undefined,
    ...(allowancePeriod ? { allowancePeriod } : {}) };
}

/** Never mix the selected tier with another membership's period or infer a cadence. */
export function selectAllowancePeriod(memberships: WhopMembership[], tier: string, subjectId: string,
  companyId: string, now = Date.now()): VerifiedAllowancePeriod | undefined {
  if (tier !== 'CORE' && tier !== 'ENTERPRISE') return;
  const candidates = memberships.filter(m => {
    if ((m.user_id || relationId(m.user)) !== subjectId || (m.company_id || relationId(m.company)) !== companyId ||
        !membershipCurrentlyEntitled(m, now)) return false;
    try { return resolveWhopSubscription(m).tier === tier; } catch { return false; }
  });
  // Ambiguous memberships require reviewed transfer/stacking policy, not a new bucket.
  if (candidates.length !== 1) return;
  const m = candidates[0];
  if (!['active', 'canceling'].includes(m.status?.toLowerCase() || '')) return;
  const start = timestamp(m.renewal_period_start), end = timestamp(m.renewal_period_end);
  const billingDays = m.billing_period_days ?? m.plan?.billing_period;
  if (!m.id || !m.plan?.id || start === null || end === null || start > now || end <= now || start >= end || end - start < 27 * 86400000 || end - start > 32 * 86400000 ||
      !Number.isInteger(billingDays) || billingDays! < 28 || billingDays! > 31) return;
  return { tier, membershipId: m.id, companyId, subjectId, planId: m.plan.id,
    billingDays: billingDays!, start, end, verifiedAt: now };
}

export function membershipSubject(payload: unknown): { whopId?: string; email?: string } {
  if (!isObject(payload) || !isObject(payload.data)) return {};
  const data = payload.data;
  const membership = isObject(data.membership) ? data.membership : data;
  const user = isObject(membership.user)
    ? membership.user
    : isObject(data.user) ? data.user
      : isObject(data.member) && isObject(data.member.user) ? data.member.user : undefined;
  return {
    whopId: (typeof membership.user_id === "string" ? membership.user_id : undefined)
      || (typeof user?.id === "string" ? user.id : undefined)
      || (typeof data.user_id === "string" ? data.user_id : undefined),
    email: typeof user?.email === "string" ? user.email
      : typeof data.email === "string" ? data.email : undefined,
  };
}
