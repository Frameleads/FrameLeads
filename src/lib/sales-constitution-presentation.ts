type Constraint = {
  kind?: string;
  threshold?: number;
  comparison?: string;
  minimum?: number;
  terms?: string[];
  topic?: string;
  field?: string;
  operator?: string;
  value?: string | number;
  conditions?: Constraint[];
};

export function formatConstitutionLabel(value: string) {
  return value.toLowerCase().split('_').filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
}

const numberLabel = (value: number) => Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));

function formatLeaf(condition: Constraint): string {
  const field = condition.field?.replaceAll('_', ' ').toLowerCase()
    .replace(/\b\w/g, character => character.toUpperCase()) ?? 'Value';
  const operator = ({ GT: '>', GTE: '≥', LT: '<', LTE: '≤', EQ: 'is', NEQ: 'is not', CONTAINS: 'contains' } as Record<string, string>)[condition.operator ?? '']
    ?? formatConstitutionLabel(condition.operator ?? 'matches');
  const value = typeof condition.value === 'number' ? numberLabel(condition.value) :
    typeof condition.value === 'string' ? formatConstitutionLabel(condition.value) : 'the configured value';
  return `${field} ${operator} ${value}`;
}

export function formatConstitutionCondition(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Condition details unavailable';
  const constraint = value as Constraint;
  switch (constraint.kind) {
    case 'DISCOUNT_PERCENT':
      if (typeof constraint.threshold !== 'number' || !Number.isFinite(constraint.threshold)) return 'Discount threshold is configured';
      return `Discount ${constraint.comparison === 'GTE' ? '≥' : constraint.comparison === 'LTE' ? '≤' : constraint.comparison === 'LT' ? '<' : '>'} ${numberLabel(constraint.threshold)}%`;
    case 'MIN_CONTRACT_MONTHS':
      return typeof constraint.minimum === 'number' && Number.isFinite(constraint.minimum)
        ? `Contract term below ${numberLabel(constraint.minimum)} months` : 'Minimum contract term applies';
    case 'PROHIBITED_CLAIM':
      return constraint.terms?.length ? `Claim includes ${constraint.terms.join(', ')}` : 'A prohibited claim is detected';
    case 'TOPIC':
      return constraint.topic ? `Message concerns ${formatConstitutionLabel(constraint.topic)}` : 'Configured topic is detected';
    case 'UNSUBSCRIBE':
      return 'A prospect asks to unsubscribe';
    case 'CUSTOM_MANUAL':
      return 'Manual review is required';
    case 'FACT':
      return formatLeaf(constraint);
    case 'ALL':
    case 'ANY': {
      const conditions = constraint.conditions?.map(formatConstitutionCondition).filter(Boolean) ?? [];
      return conditions.length ? conditions.join(constraint.kind === 'ALL' ? ' and ' : ' or ') : 'Configured conditions are evaluated';
    }
    default:
      return constraint.kind ? `${formatConstitutionLabel(constraint.kind)} condition` : 'Condition details unavailable';
  }
}

export function formatConstitutionScope(scope: string, source: string) {
  return [formatConstitutionLabel(scope), formatConstitutionLabel(source)].filter(Boolean).join(' · ');
}

export function formatConstitutionCategory(category: string) {
  const display = category === 'DISCOUNT' || category === 'PRICING' ? 'Pricing' :
    category === 'COMMERCIAL_TERM' ? 'Commercial Terms' : formatConstitutionLabel(category);
  return `${display} Governance`;
}
