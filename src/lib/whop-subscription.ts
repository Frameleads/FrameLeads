export type WhopSubscription = {
  tier: "MICRO_PILOT" | "CORE" | "ENTERPRISE";
  monthlyQuota: number;
};

export class NoActivePaidSubscriptionError extends Error {
  readonly code = "NO_ACTIVE_PAID_SUBSCRIPTION";

  constructor() {
    super("No active paid subscription found");
    this.name = "NoActivePaidSubscriptionError";
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

function collectTierIdentifiers(source: unknown, seen = new Set<object>()): string[] {
  if (Array.isArray(source)) {
    return source.flatMap((item) => collectTierIdentifiers(item, seen));
  }

  if (!source || typeof source !== "object" || seen.has(source)) {
    return [];
  }
  seen.add(source);

  const record = source as Record<string, unknown>;
  const identifiers: string[] = [];

  for (const field of ["plan", "product"] as const) {
    const value = record[field];
    if (typeof value === "string") {
      identifiers.push(value);
      continue;
    }

    if (value && typeof value === "object") {
      const expanded = value as Record<string, unknown>;
      for (const property of ["id", "name", "title"] as const) {
        if (typeof expanded[property] === "string") {
          identifiers.push(expanded[property]);
        }
      }
    }
  }

  // OAuth membership arrays contain plan/product directly. Webhook payloads
  // may wrap them in data or membership objects.
  for (const field of ["data", "membership"] as const) {
    identifiers.push(...collectTierIdentifiers(record[field], seen));
  }

  return identifiers;
}

/** Resolves the highest FrameLeads tier present in a Whop payload. */
export function resolveWhopSubscription(source: unknown): WhopSubscription {
  const identifiers = collectTierIdentifiers(source).map((value) =>
    value.toLowerCase(),
  );
  const identifierText = identifiers.join(" ");
  const mappings: Array<{
    tier: WhopSubscription["tier"];
    monthlyQuota: number;
    ids: readonly string[];
    titlePattern: RegExp;
  }> = [
    {
      tier: "ENTERPRISE",
      monthlyQuota: 20_000,
      ids: configuredIds("WHOP_ENTERPRISE_IDS", DEFAULT_TIER_IDS.ENTERPRISE),
      titlePattern: /\benterprise\b/i,
    },
    {
      tier: "CORE",
      monthlyQuota: 500,
      ids: configuredIds("WHOP_CORE_IDS", DEFAULT_TIER_IDS.CORE),
      titlePattern: /\bcore\b/i,
    },
    {
      tier: "MICRO_PILOT",
      monthlyQuota: 25,
      ids: configuredIds("WHOP_MICRO_IDS", DEFAULT_TIER_IDS.MICRO_PILOT),
      titlePattern: /\b(?:micro|pilot)\b/i,
    },
  ];

  for (const mapping of mappings) {
    if (
      mapping.ids.some((id) => identifiers.includes(id.toLowerCase())) ||
      mapping.titlePattern.test(identifierText)
    ) {
      return { tier: mapping.tier, monthlyQuota: mapping.monthlyQuota };
    }
  }

  throw new NoActivePaidSubscriptionError();
}
