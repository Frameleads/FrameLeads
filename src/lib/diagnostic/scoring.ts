export const CATEGORIES = [
  'Reply Operations', 'Decision Speed', 'Governance',
  'Revenue Prioritization', 'Prospect Context', 'Automation Risk',
] as const;
export type Category = typeof CATEGORIES[number];
type Option = { value: string; label: string; score: number | null };
type Question = { id: string; label: string; category: Category | null; options: readonly Option[] };
const option = (value: string, label: string, score: number | null): Option => ({ value, label, score });

/** Volume is context, not a maturity penalty. "Not sure" scores neutrally and lowers confidence. */
export const QUESTIONS: readonly Question[] = [
  { id: 'volume', label: 'About how many inbound replies arrive each month?', category: null, options: [
    option('under_25', 'Fewer than 25', null), option('25_100', '25–100', null),
    option('101_500', '101–500', null), option('over_500', 'More than 500', null),
    option('not_sure', 'Not sure', null)] },
  { id: 'ownership', label: 'Who handles those replies?', category: 'Reply Operations', options: [
    option('one_named', 'One named owner', 100), option('small_named', '2–3 people with clear ownership', 100),
    option('large_named', '4+ people with clear ownership', 90),
    option('shared_unassigned', 'Shared inbox without clear ownership', 0), option('not_sure', 'Not sure', 50)] },
  { id: 'delay', label: 'How quickly do important replies usually get a decision?', category: 'Decision Speed', options: [
    option('under_hour', 'Within an hour', 100), option('one_to_four', 'Within four hours', 80),
    option('same_day', 'Same day', 55), option('next_day', 'Next day or later', 0),
    option('not_sure', 'Not sure', 50)] },
  { id: 'triage', label: 'How are replies categorized today?', category: 'Reply Operations', options: [
    option('consistent', 'Consistent categories and review', 100), option('shared_labels', 'Shared labels, applied manually', 70),
    option('ad_hoc', 'People decide case by case', 20), option('none', 'No consistent triage', 0),
    option('not_sure', 'Not sure', 50)] },
  { id: 'priority', label: 'Are commercially important replies separated from routine replies?', category: 'Revenue Prioritization', options: [
    option('ranked', 'Yes, using recorded opportunity signals', 100), option('simple_flags', 'Some manual flags', 65),
    option('arrival_order', 'Usually handled in arrival order', 0), option('not_sure', 'Not sure', 50)] },
  { id: 'history', label: 'Can the handler see the prospect’s prior conversation and context?', category: 'Prospect Context', options: [
    option('in_workflow', 'Yes, in the reply workflow', 100), option('several_tools', 'Only by checking several tools', 50),
    option('rarely', 'Rarely or not reliably', 0), option('not_sure', 'Not sure', 50)] },
  { id: 'rules', label: 'How are pricing, compliance, and handling rules enforced?', category: 'Governance', options: [
    option('enforced', 'Documented and consistently enforced', 100), option('documented_manual', 'Documented, checked manually', 65),
    option('informal', 'Mostly informal guidance', 25), option('none', 'No clear rules', 0),
    option('not_sure', 'Not sure', 50)] },
  { id: 'ai', label: 'Can AI respond to prospects automatically?', category: 'Automation Risk', options: [
    option('no_ai', 'No automatic AI replies', 80), option('drafts_reviewed', 'AI drafts; a human reviews sends', 100),
    option('governed_auto', 'Yes, within explicit rules and limits', 100),
    option('ungoverned_auto', 'Yes, without clear controls', 0), option('not_sure', 'Not sure', 50)] },
  { id: 'human', label: 'Do sensitive cases require human approval or intervention?', category: 'Governance', options: [
    option('always', 'Yes, consistently', 100), option('usually', 'Usually', 70),
    option('ad_hoc', 'Case by case', 30), option('none', 'No defined requirement', 0),
    option('not_sure', 'Not sure', 50)] },
  { id: 'escalation', label: 'Is there a defined route for legal, security, procurement, or high-value replies?', category: 'Governance', options: [
    option('defined', 'Yes, with named responsibility', 100), option('informal', 'An informal route', 50),
    option('none', 'No defined route', 0), option('not_sure', 'Not sure', 50)] },
  { id: 'sla', label: 'Are response deadlines explicit and tracked?', category: 'Decision Speed', options: [
    option('tracked', 'Yes, deadlines are monitored', 100), option('informal', 'Targets exist but are not tracked', 50),
    option('none', 'No response deadline', 0), option('not_sure', 'Not sure', 50)] },
  { id: 'revenue', label: 'Does ICP fit or opportunity importance affect reply priority?', category: 'Revenue Prioritization', options: [
    option('factored', 'Yes, using recorded context', 100), option('manual', 'People consider it manually', 60),
    option('none', 'No, or the information is unavailable', 0), option('not_sure', 'Not sure', 50)] },
] as const;

export const REAL_CAPABILITIES = [
  'Smarter Inbox Triage / Decision Engine', 'Response SLA Engine', 'Revenue-at-Risk',
  'Persistent Prospect Memory', 'Sales Constitution', 'Flexible Automation Modes',
  'Scout / ICP Intelligence',
] as const;
type Capability = typeof REAL_CAPABILITIES[number];
export type Gap = { id: string; title: string; why: string; capability: Capability };
type GapRule = Gap & { priority: number; when: (answers: Record<string, string>) => boolean };
const GAPS: readonly GapRule[] = [
  { id: 'uncontrolled_ai', priority: 1, title: 'Automatic replies lack clear controls',
    why: 'You reported automatic AI replies without defined guardrails.', capability: 'Flexible Automation Modes',
    when: a => a.ai === 'ungoverned_auto' },
  { id: 'weak_governance', priority: 2, title: 'Sensitive decisions lack reliable human review',
    why: 'Sensitive cases are not consistently held for human judgment.', capability: 'Sales Constitution',
    when: a => ['ad_hoc', 'none'].includes(a.human) },
  { id: 'missing_rules', priority: 3, title: 'Sales handling rules are not consistently enforced',
    why: 'Pricing, compliance, or handling rules rely on informal judgment.', capability: 'Sales Constitution',
    when: a => ['informal', 'none'].includes(a.rules) },
  { id: 'no_escalation', priority: 4, title: 'Specialized replies lack a defined escalation route',
    why: 'Legal, security, procurement, or high-value cases have no named route.', capability: 'Flexible Automation Modes',
    when: a => a.escalation === 'none' },
  { id: 'no_priority', priority: 5, title: 'Commercially important replies are not prioritized',
    why: 'Replies are usually handled in arrival order.', capability: 'Revenue-at-Risk',
    when: a => a.priority === 'arrival_order' },
  { id: 'no_sla', priority: 6, title: 'Reply deadlines are not tracked',
    why: 'Your team does not have monitored response deadlines.', capability: 'Response SLA Engine',
    when: a => ['none', 'informal'].includes(a.sla) },
  { id: 'slow_response', priority: 7, title: 'Important reply decisions are delayed',
    why: 'Important replies typically wait until the next day or later.', capability: 'Response SLA Engine',
    when: a => a.delay === 'next_day' },
  { id: 'scattered_context', priority: 8, title: 'Prospect history is fragmented',
    why: 'Handlers must search multiple tools or often lack prior context.', capability: 'Persistent Prospect Memory',
    when: a => ['several_tools', 'rarely'].includes(a.history) },
  { id: 'ad_hoc_triage', priority: 9, title: 'Reply classification depends on individual judgment',
    why: 'Replies are not categorized consistently.', capability: 'Smarter Inbox Triage / Decision Engine',
    when: a => ['ad_hoc', 'none'].includes(a.triage) },
  { id: 'unclear_owner', priority: 10, title: 'Reply ownership is unclear',
    why: 'A shared inbox has no consistently named handler.', capability: 'Smarter Inbox Triage / Decision Engine',
    when: a => a.ownership === 'shared_unassigned' },
  { id: 'missing_revenue_context', priority: 11, title: 'ICP and opportunity context are not used',
    why: 'Prospect importance is unavailable or does not affect priority.', capability: 'Scout / ICP Intelligence',
    when: a => a.revenue === 'none' },
] as const;

export type DiagnosticResult = { maturity: number; band: 'FRAGMENTED' | 'DEVELOPING' | 'CONTROLLED' | 'DECISION-READY';
  categoryScores: Record<Category, number>; confidence: number; gaps: Gap[];
  cta: { label: string; href: '/login' } };

export function resetDiagnosticState() { return { answers: {} as Record<string, string>, result: null as DiagnosticResult | null }; }

export function scoreDiagnostic(answers: Record<string, string>): DiagnosticResult {
  const scores = new Map<Category, number[]>();
  let knownAnswers = 0;
  for (const question of QUESTIONS) {
    const selected = question.options.find(item => item.value === answers[question.id]);
    if (!selected) throw new TypeError(`Answer required: ${question.id}`);
    if (selected.value !== 'not_sure') knownAnswers++;
    if (question.category && selected.score != null) scores.set(question.category,
      [...(scores.get(question.category) ?? []), selected.score]);
  }
  const categoryScores = Object.fromEntries(CATEGORIES.map(category => {
    const values = scores.get(category) ?? [];
    return [category, values.length ? Math.round(values.reduce((sum, score) => sum + score, 0) / values.length) : 50];
  })) as Record<Category, number>;
  const maturity = Math.round(CATEGORIES.reduce((sum, category) => sum + categoryScores[category], 0) / CATEGORIES.length);
  const band = maturity < 40 ? 'FRAGMENTED' : maturity < 65 ? 'DEVELOPING' :
    maturity < 85 ? 'CONTROLLED' : 'DECISION-READY';
  const gaps = GAPS.filter(rule => rule.when(answers)).sort((a, b) => a.priority - b.priority).slice(0, 5)
    .map(({ id, title, why, capability }) => ({ id, title, why, capability }));
  const label = band === 'FRAGMENTED' ? 'Explore FrameLeads' :
    band === 'DECISION-READY' ? 'Launch FrameLeads' : 'Get Started with FrameLeads';
  return { maturity, band, categoryScores, confidence: Math.round(knownAnswers * 100 / QUESTIONS.length),
    gaps, cta: { label, href: '/login' } };
}
