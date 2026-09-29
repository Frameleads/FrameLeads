/** Explicit import/source fields only. No AI, network, or inference from campaign context. */
export type ProspectMetadata = {
  jobTitle: string | null;
  industry: string | null;
  country: string | null;
  location: string | null;
  companySizeMin: number | null;
  companySizeMax: number | null;
};

export const emptyProspectMetadata = (): ProspectMetadata => ({
  jobTitle: null, industry: null, country: null, location: null, companySizeMin: null, companySizeMax: null,
});

const header = (value: string) => value.trim().replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[\s_-]+/g, ' ');
export const cleanFactualText = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const clean = String(value).trim().replace(/\s+/g, ' ');
  return clean && clean.length <= 200 ? clean : null;
};

const countryAliases: Record<string, string> = {
  us: 'United States', usa: 'United States', 'u s': 'United States', 'u s a': 'United States', 'united states': 'United States',
  uk: 'United Kingdom', gb: 'United Kingdom', 'great britain': 'United Kingdom', 'united kingdom': 'United Kingdom',
  ae: 'United Arab Emirates', uae: 'United Arab Emirates', 'u a e': 'United Arab Emirates', 'united arab emirates': 'United Arab Emirates',
};
export function normalizeCountry(value: unknown): string | null {
  const clean = cleanFactualText(value);
  if (!clean) return null;
  return countryAliases[clean.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ')] || clean;
}

export function parseCompanySize(value: unknown): { companySizeMin: number; companySizeMax: number | null } | null {
  const raw = cleanFactualText(value)?.replace(/,/g, '').replace(/[\u2012-\u2015]/g, '-').trim();
  if (!raw) return null;
  const exact = /^(\d{1,8})$/.exec(raw);
  const range = /^(\d{1,8})\s*(?:-|to)\s*(\d{1,8})$/i.exec(raw);
  const more = /^(\d{1,8})\s*\+$/.exec(raw);
  if (exact) return { companySizeMin: Number(exact[1]), companySizeMax: Number(exact[1]) };
  if (range && Number(range[1]) <= Number(range[2])) return { companySizeMin: Number(range[1]), companySizeMax: Number(range[2]) };
  if (more) return { companySizeMin: Number(more[1]), companySizeMax: null };
  return null;
}

const ALIASES = {
  jobTitle: ['job title', 'title', 'position', 'role'],
  industry: ['industry', 'company industry'],
  country: ['country', 'country code'],
  location: ['location', 'geography'],
  companySize: ['company size', 'employee count', 'employees', 'headcount'],
  companySizeMin: ['company size min'],
  companySizeMax: ['company size max'],
} as const;

function uniqueField(row: Record<string, unknown>, aliases: readonly string[], normalize: (value: unknown) => string | null = cleanFactualText): { value: string | null; conflict: boolean } {
  const allowed = new Set(aliases);
  const values = Object.entries(row).filter(([key]) => allowed.has(header(key))).map(([, value]) => normalize(value)).filter((value): value is string => Boolean(value));
  const unique = [...new Set(values.map(value => value.toLowerCase()))];
  return { value: unique.length === 1 ? values[0] : null, conflict: unique.length > 1 };
}

/** Conflicting aliases leave only that metadata field unknown; identity fields and other metadata survive. */
export function extractProspectMetadata(row: Record<string, unknown>): ProspectMetadata {
  const jobTitle = uniqueField(row, ALIASES.jobTitle);
  const industry = uniqueField(row, ALIASES.industry);
  const country = uniqueField(row, ALIASES.country, normalizeCountry);
  const location = uniqueField(row, ALIASES.location);
  const sizeValues = Object.entries(row).filter(([key]) => (ALIASES.companySize as readonly string[]).includes(header(key)))
    .map(([, value]) => parseCompanySize(value)).filter((value): value is NonNullable<ReturnType<typeof parseCompanySize>> => value !== null);
  const distinctSizes = [...new Set(sizeValues.map(value => `${value.companySizeMin}:${value.companySizeMax ?? '+'}`))];
  const min = uniqueField(row, ALIASES.companySizeMin);
  const max = uniqueField(row, ALIASES.companySizeMax);
  const parsed = distinctSizes.length === 1 ? sizeValues[0] : null;
  const validBound = (value: string | null) => value && /^\d{1,8}$/.test(value.replace(/,/g, '')) ? Number(value.replace(/,/g, '')) : null;
  const minBound = validBound(min.value);
  const maxBound = validBound(max.value);
  const bounds = (minBound !== null || maxBound !== null) && (minBound === null || maxBound === null || minBound <= maxBound)
    ? { companySizeMin: minBound, companySizeMax: maxBound } : null;
  const sizeConflict = distinctSizes.length > 1 || min.conflict || max.conflict ||
    min.value !== null && minBound === null || max.value !== null && maxBound === null ||
    minBound !== null && maxBound !== null && minBound > maxBound ||
    Boolean(parsed && bounds && (parsed.companySizeMin !== bounds.companySizeMin || parsed.companySizeMax !== bounds.companySizeMax));
  const chosenSize = sizeConflict ? null : parsed || bounds;
  return {
    jobTitle: jobTitle.conflict ? null : jobTitle.value,
    industry: industry.conflict ? null : industry.value,
    country: country.conflict ? null : country.value,
    location: location.conflict ? null : location.value,
    companySizeMin: chosenSize?.companySizeMin ?? null,
    companySizeMax: chosenSize?.companySizeMax ?? null,
  };
}
