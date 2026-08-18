import {
  resolveWhopSubscription,
  type WhopSubscription,
} from "@/lib/whop-subscription";

type WhopMembership = {
  status?: string;
  user?: { id?: string };
  company?: { id?: string };
  product?: { id?: string; title?: string; route?: string; metadata?: unknown };
  plan?: { id?: string; title?: string; metadata?: unknown };
  metadata?: unknown;
};

type WhopMembershipList = {
  data?: WhopMembership[];
};

const ACTIVE_MEMBERSHIP_STATUSES = new Set([
  "active",
  "trialing",
  "completed",
  "canceling",
]);

const DEFAULT_COMPANY_ID = "biz_RSQW7xARXYAQke";

export async function verifyWhopSubscription(
  accessToken: string,
  whopUserId: string,
): Promise<WhopSubscription> {
  const companyId = process.env.WHOP_COMPANY_ID || DEFAULT_COMPANY_ID;
  const membershipsUrl = new URL(
    "https://api.whop.com/api/v1/memberships",
  );
  membershipsUrl.searchParams.set("user_ids", whopUserId);
  membershipsUrl.searchParams.set("company_id", companyId);
  membershipsUrl.searchParams.set("first", "50");

  const response = await fetch(membershipsUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const rawResponse = await response.text();

  if (!response.ok) {
    console.error("[WHOP OAUTH] Membership verification rejected by Whop:", {
      status: response.status,
      statusText: response.statusText,
      rawResponse,
      whopUserId,
      companyId,
    });
    throw new Error(`Whop membership verification failed (${response.status})`);
  }

  let payload: WhopMembershipList;
  try {
    payload = JSON.parse(rawResponse) as WhopMembershipList;
  } catch (error) {
    console.error("[WHOP OAUTH] Membership verification returned invalid JSON:", {
      rawResponse,
      error,
    });
    throw new Error("Whop membership verification returned invalid JSON");
  }

  if (!Array.isArray(payload.data)) {
    console.error("[WHOP OAUTH] Membership response omitted its data array.");
    throw new Error("Whop membership response is malformed");
  }

  const activeMemberships = payload.data.filter((membership) => {
    const belongsToUser = membership.user?.id === whopUserId;
    const belongsToCompany = membership.company?.id === companyId;
    const isActive = ACTIVE_MEMBERSHIP_STATUSES.has(
      membership.status?.toLowerCase() || "",
    );

    return belongsToUser && belongsToCompany && isActive;
  });

  const subscription = resolveWhopSubscription(activeMemberships);
  console.log("[WHOP OAUTH] Verified membership during login:", {
    whopUserId,
    activeMemberships: activeMemberships.length,
    tier: subscription.tier,
    monthlyQuota: subscription.monthlyQuota,
  });

  return subscription;
}
