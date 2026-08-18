export type WhopSubscription = {
  tier: "FREE" | "MICRO_PILOT" | "CORE" | "ENTERPRISE";
  monthlyQuota: number;
};

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

/** Resolves the highest FrameLeads tier present in a Whop payload. */
export function resolveWhopSubscription(source: unknown): WhopSubscription {
  const payloadString = JSON.stringify(source ?? "").toLowerCase();
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
      mapping.ids.some((id) => payloadString.includes(id.toLowerCase())) ||
      mapping.titlePattern.test(payloadString)
    ) {
      return { tier: mapping.tier, monthlyQuota: mapping.monthlyQuota };
    }
  }

  return { tier: "FREE", monthlyQuota: 0 };
}
