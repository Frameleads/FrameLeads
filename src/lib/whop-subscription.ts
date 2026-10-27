import { isWhopSandbox } from "./whop-environment";

export type WhopSubscription = {
  tier: "MICRO_PILOT" | "CORE" | "ENTERPRISE";
  monthlyQuota: number;
  /** Earliest known renewal/expiry boundary for a fresh membership recheck. */
  validUntil?: number;
};

export class MembershipFilteredOutError extends Error {
  readonly code = "MEMBERSHIP_FILTERED_OUT";

  constructor(totalMemberships: number) {
    super(
      `Membership filtered out: none of ${totalMemberships} membership(s) matched the expected user, company, and paid status`,
    );
    this.name = "MembershipFilteredOutError";
  }
}

export class UnrecognizedWhopProductError extends Error {
  readonly code = "UNRECOGNIZED_WHOP_PRODUCT";

  constructor() {
    super("Unrecognized Whop product ID, plan ID, or product name");
    this.name = "UnrecognizedWhopProductError";
  }
}

const LEGACY_ENTERPRISE_PLAN_IDS = new Set([
  "plan_PZqjKqvMr0KBI", "plan_jdy5Z44fMKMAz",
].map(id => id.toLowerCase()));

const DEFAULT_TIER_IDS = {
  MICRO_PILOT: ["prod_bTf6npFBh6teM", "plan_8qLWfJZHQUYZf"],
  CORE: ["prod_1GtBYI46Z2HQS", "plan_MUeh0CYdRPPaJ", "plan_sAEhr77rTrhX4", "plan_GQTDPXnvijugf"],
  ENTERPRISE: ["prod_7CoRolH7SDjmQ", "plan_PZqjKqvMr0KBI", "plan_jdy5Z44fMKMAz", "plan_uGDGf5WKW7hlE"],
} as const;

function configuredIds(name: string, defaults: readonly string[]) {
  const values = process.env[name]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return isWhopSandbox() ? [...new Set(values ?? [])] : [...new Set([...defaults, ...(values ?? [])])];
}

function configuredPattern(name: string, fallback: RegExp) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;

  try {
    return new RegExp(value, "i");
  } catch (error) {
    console.error(`[WHOP CONFIG] Invalid ${name}; using built-in pattern.`, { error });
    return fallback;
  }
}

type TierIdentifiers = {
  productIds: string[];
  planIds: string[];
  names: string[];
  rawProductPlans: Array<{ product: unknown; plan: unknown }>;
};

function emptyIdentifiers(): TierIdentifiers {
  return { productIds: [], planIds: [], names: [], rawProductPlans: [] };
}

function collectTierIdentifiers(
  source: unknown,
  seen = new Set<object>(),
): TierIdentifiers {
  if (Array.isArray(source)) {
    return source.reduce<TierIdentifiers>((result, item) => {
      const nested = collectTierIdentifiers(item, seen);
      result.productIds.push(...nested.productIds);
      result.planIds.push(...nested.planIds);
      result.names.push(...nested.names);
      result.rawProductPlans.push(...nested.rawProductPlans);
      return result;
    }, emptyIdentifiers());
  }

  if (!source || typeof source !== "object" || seen.has(source)) {
    return emptyIdentifiers();
  }
  seen.add(source);

  const record = source as Record<string, unknown>;
  const identifiers = emptyIdentifiers();

  if ("product" in record || "plan" in record) {
    identifiers.rawProductPlans.push({
      product: record.product,
      plan: record.plan,
    });
  }

  for (const field of ["plan", "product"] as const) {
    const value = record[field];
    if (typeof value === "string") {
      if (field === "plan") identifiers.planIds.push(value);
      else identifiers.productIds.push(value);
      continue;
    }

    if (value && typeof value === "object") {
      const expanded = value as Record<string, unknown>;
      if (typeof expanded.id === "string") {
        if (field === "plan") identifiers.planIds.push(expanded.id);
        else identifiers.productIds.push(expanded.id);
      }
      for (const property of ["name", "title"] as const) {
        if (typeof expanded[property] === "string") {
          identifiers.names.push(expanded[property]);
        }
      }
    }
  }

  // OAuth membership arrays contain plan/product directly. Webhook payloads
  // may wrap them in data or membership objects.
  for (const field of ["data", "membership"] as const) {
    const nested = collectTierIdentifiers(record[field], seen);
    identifiers.productIds.push(...nested.productIds);
    identifiers.planIds.push(...nested.planIds);
    identifiers.names.push(...nested.names);
    identifiers.rawProductPlans.push(...nested.rawProductPlans);
  }

  return identifiers;
}

/** Resolves the highest FrameLeads tier present in a Whop payload. */
export function resolveWhopSubscription(source: unknown): WhopSubscription {
  const observed = collectTierIdentifiers(source);
  const productIds = observed.productIds.map((value) => value.toLowerCase());
  const planIds = observed.planIds.map((value) => value.toLowerCase());
  const names = observed.names.map((value) => value.toLowerCase());
  const observedIds = [...productIds, ...planIds];
  const nameText = names.join(" ");
  const mappings: Array<{
    tier: WhopSubscription["tier"];
    monthlyQuota: number;
    ids: readonly string[];
    idsEnvironmentVariable: string;
    namePattern: RegExp;
    patternEnvironmentVariable: string;
  }> = [
    {
      tier: "ENTERPRISE",
      monthlyQuota: 20_000,
      ids: configuredIds("WHOP_ENTERPRISE_IDS", DEFAULT_TIER_IDS.ENTERPRISE),
      idsEnvironmentVariable: "WHOP_ENTERPRISE_IDS",
      namePattern: configuredPattern(
        "WHOP_ENTERPRISE_PATTERN",
        /\benterprise\b/i,
      ),
      patternEnvironmentVariable: "WHOP_ENTERPRISE_PATTERN",
    },
    {
      tier: "CORE",
      monthlyQuota: 500,
      ids: configuredIds("WHOP_CORE_IDS", DEFAULT_TIER_IDS.CORE),
      idsEnvironmentVariable: "WHOP_CORE_IDS",
      namePattern: configuredPattern("WHOP_CORE_PATTERN", /\bcore\b/i),
      patternEnvironmentVariable: "WHOP_CORE_PATTERN",
    },
    {
      tier: "MICRO_PILOT",
      monthlyQuota: 25,
      ids: configuredIds("WHOP_MICRO_IDS", DEFAULT_TIER_IDS.MICRO_PILOT),
      idsEnvironmentVariable: "WHOP_MICRO_IDS",
      namePattern: configuredPattern(
        "WHOP_MICRO_PATTERN",
        /\b(?:micro|pilot)\b/i,
      ),
      patternEnvironmentVariable: "WHOP_MICRO_PATTERN",
    },
  ];

  for (const mapping of mappings) {
    const matchedId = mapping.ids.find((id) => observedIds.includes(id.toLowerCase()));
    if (matchedId) {
      // New Enterprise purchases receive 10k, including Sandbox. Retired
      // Enterprise plan IDs preserve their contract; grandfathered existing
      // customers on a current plan are handled per-account in whop-user and
      // the entitlement refresher, not by increasing every buyer's limit.
      const legacyEnterprisePlan = planIds.some(id => LEGACY_ENTERPRISE_PLAN_IDS.has(id));
      const monthlyQuota = mapping.tier === "ENTERPRISE"
        ? (!isWhopSandbox() && legacyEnterprisePlan ? 20_000 : 10_000)
        : mapping.monthlyQuota;
      console.info("[WHOP] Paid tier resolved", {
        tier: mapping.tier,
        matchedBy: "product_or_plan_id",
      });
      return { tier: mapping.tier, monthlyQuota };
    }
  }

  // Sandbox must match exact configured plan IDs, never display names or live-plan defaults.
  if (isWhopSandbox()) throw new UnrecognizedWhopProductError();

  for (const mapping of mappings) {
    if (mapping.namePattern.test(nameText)) {
      console.info("[WHOP] Paid tier resolved", { tier: mapping.tier, matchedBy: "product_or_plan_name" });
      return { tier: mapping.tier, monthlyQuota: mapping.tier === "ENTERPRISE" ? 10_000 : mapping.monthlyQuota };
    }
  }

  console.warn("[WHOP] Membership plan did not match a configured tier", {
    productCount: observed.productIds.length,
    planCount: observed.planIds.length,
  });
  throw new UnrecognizedWhopProductError();
}
