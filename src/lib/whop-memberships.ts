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
  cancel_at_period_end?: boolean;
  renewal_period_end?: string | number | null;
  expires_at?: string | number | null;
  product?: { id?: string; name?: string; title?: string; route?: string; metadata?: unknown };
  plan?: { id?: string; name?: string; title?: string; metadata?: unknown };
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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function verifyWhopSubscription(
  accessToken: string,
  whopUserId: string,
  request: typeof fetch = fetch,
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
    memberships.push(...payload.data);

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
  return { ...subscription, validUntil: periodEnds.length ? Math.min(...periodEnds) : undefined };
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
