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
  // A user OAuth token already scopes this request. Whop documents user_ids
  // and company_id as optional filters, so omit them from the wire request and
  // enforce both identifiers against every returned membership below.
  membershipsUrl.searchParams.set("first", "50");

  let response: Response | undefined;
  let rawResponse = "";

  try {
    response = await fetch(membershipsUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    rawResponse = await response.text();
  } catch (error) {
    console.error("[WHOP OAUTH] Membership API request could not complete:", {
      endpoint: membershipsUrl.toString(),
      status: response?.status ?? null,
      responseText: rawResponse || null,
      error,
      whopUserId,
      companyId,
    });
    throw new Error("Whop membership API request could not complete", {
      cause: error,
    });
  }

  if (!response.ok) {
    console.error("[WHOP OAUTH] Membership verification rejected by Whop:", {
      endpoint: membershipsUrl.toString(),
      status: response.status,
      statusText: response.statusText,
      responseText: rawResponse,
      whopUserId,
      companyId,
    });
    throw new Error(
      `Whop membership verification failed (${response.status}): ${rawResponse}`,
    );
  }

  let payload: WhopMembershipList;
  try {
    payload = JSON.parse(rawResponse) as WhopMembershipList;
  } catch (error) {
    console.error("[WHOP OAUTH] Membership verification returned invalid JSON:", {
      endpoint: membershipsUrl.toString(),
      status: response.status,
      responseText: rawResponse,
      error,
    });
    throw new Error(
      `Whop membership verification returned invalid JSON: ${rawResponse}`,
      { cause: error },
    );
  }

  if (!Array.isArray(payload.data)) {
    console.error("[WHOP OAUTH] Membership response omitted its data array:", {
      endpoint: membershipsUrl.toString(),
      status: response.status,
      responseText: rawResponse,
    });
    throw new Error(`Whop membership response is malformed: ${rawResponse}`);
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
