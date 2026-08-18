import {
  MembershipFilteredOutError,
  resolveWhopSubscription,
  type WhopSubscription,
} from "@/lib/whop-subscription";

type WhopMembership = {
  id?: string;
  status?: string;
  user_id?: string;
  user?: string | { id?: string };
  company_id?: string;
  company?: string | { id?: string };
  product?: {
    id?: string;
    name?: string;
    title?: string;
    route?: string;
    metadata?: unknown;
  };
  plan?: { id?: string; name?: string; title?: string; metadata?: unknown };
  metadata?: unknown;
};

type WhopMembershipList = {
  data?: WhopMembership[];
};

const ACTIVE_MEMBERSHIP_STATUSES = new Set([
  "active",
  "trialing",
  "completed",
  "valid",
  "past_due",
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
  membershipsUrl.searchParams.append("expand", "product");
  membershipsUrl.searchParams.append("expand", "plan");
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

  console.log(
    "[WHOP DEBUG] Raw Memberships:",
    JSON.stringify(payload.data, null, 2),
  );

  const activeMemberships = payload.data.filter((membership) => {
    const expandedUserId =
      typeof membership.user === "object" ? membership.user?.id : undefined;
    const compactUserId =
      typeof membership.user === "string" ? membership.user : undefined;
    const belongsToUser = [
      membership.user_id,
      expandedUserId,
      compactUserId,
    ].includes(whopUserId);

    const expandedCompanyId =
      typeof membership.company === "object"
        ? membership.company?.id
        : undefined;
    const compactCompanyId =
      typeof membership.company === "string" ? membership.company : undefined;
    const membershipCompanyIds = [
      membership.company_id,
      expandedCompanyId,
      compactCompanyId,
    ].filter((value): value is string => Boolean(value));

    // User OAuth scopes the response. When Whop omits company information,
    // accept the membership after the user ID matches; reject an explicit
    // company value only when it belongs to a different company.
    const belongsToCompany =
      !companyId ||
      membershipCompanyIds.length === 0 ||
      membershipCompanyIds.includes(companyId);
    const isActive = ACTIVE_MEMBERSHIP_STATUSES.has(
      membership.status?.toLowerCase() || "",
    );

    if (!belongsToUser) {
      console.log("[WHOP DEBUG] Rejected: User ID mismatch", {
        membershipId: membership.id || null,
        expectedUserId: whopUserId,
        actualUserIds: [
          membership.user_id,
          expandedUserId,
          compactUserId,
        ].filter(Boolean),
      });
    }

    if (!belongsToCompany) {
      console.log("[WHOP DEBUG] Rejected: Company ID mismatch", {
        membershipId: membership.id || null,
        expectedCompanyId: companyId || null,
        actualCompanyIds: membershipCompanyIds,
      });
    }

    if (!isActive) {
      console.log("[WHOP DEBUG] Rejected: Status was", {
        membershipId: membership.id || null,
        actualStatus: membership.status || null,
        normalizedStatus: membership.status?.toLowerCase() || null,
        allowedStatuses: Array.from(ACTIVE_MEMBERSHIP_STATUSES),
      });
    }

    if (!belongsToUser || !belongsToCompany || !isActive) {
      console.warn(
        "[WHOP DEBUG] Membership filtered out:",
        JSON.stringify({
          membershipId: membership.id || null,
          user: {
            expected: whopUserId,
            actual: [
              membership.user_id,
              expandedUserId,
              compactUserId,
            ].filter(Boolean),
            matched: belongsToUser,
          },
          company: {
            expected: companyId || null,
            actual: membershipCompanyIds,
            omittedByWhop: membershipCompanyIds.length === 0,
            matched: belongsToCompany,
          },
          status: {
            expected: Array.from(ACTIVE_MEMBERSHIP_STATUSES),
            actual: membership.status || null,
            normalized: membership.status?.toLowerCase() || null,
            matched: isActive,
          },
          productId: membership.product?.id || null,
          planId: membership.plan?.id || null,
        }),
      );
    }

    return belongsToUser && belongsToCompany && isActive;
  });

  if (activeMemberships.length === 0) {
    throw new MembershipFilteredOutError(payload.data.length);
  }

  const subscription = resolveWhopSubscription(activeMemberships);
  console.log("[WHOP OAUTH] Verified membership during login:", {
    whopUserId,
    activeMemberships: activeMemberships.length,
    tier: subscription.tier,
    monthlyQuota: subscription.monthlyQuota,
  });

  return subscription;
}
