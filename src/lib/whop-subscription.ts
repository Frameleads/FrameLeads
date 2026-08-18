export type WhopSubscription = {
  tier: "MICRO_PILOT" | "CORE" | "ENTERPRISE";
  monthlyQuota: number;
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

const DEFAULT_TIER_IDS = {
  MICRO_PILOT: ["prod_bTf6npFBh6teM", "plan_8qLWfJZHQUYZf"],
  CORE: ["prod_1GtBYI46Z2HQS", "plan_MUeh0CYdRPPaJ"],
  ENTERPRISE: ["prod_7CoRolH7SDjmQ", "plan_PZqjKqvMr0KBI"],
} as const;

function configuredIds(name: string, defaults: readonly string[]) {
  const values = process.env[name]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return values?.length ? values : defaults;
}

function configuredPattern(name: string, fallback: RegExp) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;

  try {
    return new RegExp(value, "i");
  } catch (error) {
    console.error(`[WHOP CONFIG] Invalid ${name}; using built-in pattern.`, {
      value,
      error,
    });
    return fallback;
  }
}

type TierIdentifiers = {
  productIds: string[];
  planIds: string[];
  names: string[];
};

function emptyIdentifiers(): TierIdentifiers {
  return { productIds: [], planIds: [], names: [] };
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
      return result;
    }, emptyIdentifiers());
  }

  if (!source || typeof source !== "object" || seen.has(source)) {
    return emptyIdentifiers();
  }
  seen.add(source);

  const record = source as Record<string, unknown>;
  const identifiers = emptyIdentifiers();

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
    const matchedId = mapping.ids.find((id) =>
      observedIds.includes(id.toLowerCase()),
    );
    const matchedName = mapping.namePattern.test(nameText);

    if (matchedId || matchedName) {
      console.log("[WHOP DEBUG] Resolved paid tier:", {
        tier: mapping.tier,
        matchedBy: matchedId ? "product_or_plan_id" : "product_or_plan_name",
        matchedValue: matchedId || nameText,
        idsEnvironmentVariable: mapping.idsEnvironmentVariable,
        patternEnvironmentVariable: mapping.patternEnvironmentVariable,
      });
      return { tier: mapping.tier, monthlyQuota: mapping.monthlyQuota };
    }
  }

  console.error(
    "[WHOP DEBUG] Unrecognized product/plan:",
    JSON.stringify(
      {
        observed: {
          productIds: observed.productIds,
          planIds: observed.planIds,
          names: observed.names,
        },
        configuredMappings: mappings.map((mapping) => ({
          tier: mapping.tier,
          ids: mapping.ids,
          idsEnvironmentVariable: mapping.idsEnvironmentVariable,
          namePattern: mapping.namePattern.source,
          patternEnvironmentVariable: mapping.patternEnvironmentVariable,
        })),
      },
      null,
      2,
    ),
  );
  throw new UnrecognizedWhopProductError();
}
