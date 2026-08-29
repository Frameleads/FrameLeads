import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VSL_RULE_PREFIX = '[VSL]';
const REVIEW_LATENCY_MS = (18 * 60 + 42) * 1_000;

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000);
}

async function main() {
  const requestedEmail = (
    process.env.VSL_SEED_USER_EMAIL
    || process.env.NEXT_PUBLIC_ADMIN_EMAIL
    || 'akramwmm@gmail.com'
  ).trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: requestedEmail },
    select: { id: true, email: true, tier: true },
  });

  if (!user) {
    throw new Error(
      `No local user found for ${requestedEmail}. Set VSL_SEED_USER_EMAIL to an existing account and rerun.`,
    );
  }

  const queueSignals = [
    {
      sourceMessageId: 'vsl-queue-sarah-jenkins',
      prospectName: 'Sarah Jenkins',
      prospectContext: 'TechFlow Enterprise | Enterprise SaaS | Salesforce integration review',
      prospectEmail: 'sarah.jenkins@techflow.example',
      pipelineValue: 50_000,
      dealStage: 'Velvet Rope Paused — Requires Human Approval',
      rawEmail: 'This looks great. I have time on Tuesday at 2:00 PM EST to discuss. Quick question though: we use Salesforce, does this integrate natively?',
      intentRisk: 'Meeting Requested, Competitor Mentioned',
      signals: ['Meeting Requested', 'Competitor Mentioned'],
      intentType: 'HOT',
      intentScore: 92,
      confidenceScore: 97,
      signalAnalysis: 'Confirm Tuesday at 2:00 PM EST, then answer the Salesforce integration question directly before moving toward signature.',
      aiDraft: 'Tuesday at 2:00 PM EST works perfectly. Salesforce integrates natively, and I can walk you through the exact workflow during our conversation.',
      status: 'PENDING',
      createdAt: minutesAgo(7),
      approvedAt: null,
      isHighPriority: true,
      sourceType: 'VSL_DEMO',
      signalType: 'EMAIL_REPLY',
    },
    {
      sourceMessageId: 'vsl-queue-marcus-thorne',
      prospectName: 'Marcus Thorne',
      prospectContext: 'Procre8 | Infrastructure evaluation | Q3 buying cycle',
      prospectEmail: 'marcus.thorne@procre8.example',
      pipelineValue: 40_000,
      dealStage: 'Drafting Reply — Autonomously Handled',
      rawEmail: 'Send over the pricing details, our team is evaluating infrastructure tools this quarter.',
      intentRisk: 'Pricing Inquiry, Requesting Resources',
      signals: ['Pricing Inquiry', 'Requesting Resources'],
      intentType: 'WARM',
      intentScore: 68,
      confidenceScore: 91,
      signalAnalysis: 'Send a concise pricing overview tied to this quarter’s evaluation criteria and offer one focused implementation call.',
      aiDraft: 'Absolutely — I’ll send the pricing breakdown and the infrastructure comparison sheet. If useful, we can also cover the implementation path in a focused 20-minute review this week.',
      status: 'PENDING',
      createdAt: minutesAgo(19),
      approvedAt: null,
      isHighPriority: false,
      sourceType: 'VSL_DEMO',
      signalType: 'EMAIL_REPLY',
    },
    {
      sourceMessageId: 'vsl-queue-david-chen',
      prospectName: 'David Chen',
      prospectContext: 'Horizon Partners | Deferred initiative | Q4 follow-up',
      prospectEmail: 'david.chen@horizonpartners.example',
      pipelineValue: 30_000,
      dealStage: 'Rejected — Archived for Q4',
      rawEmail: 'Not a priority right now, check back in Q4.',
      intentRisk: 'Timing Objection',
      signals: ['Timing Objection'],
      intentType: 'COLD',
      intentScore: 12,
      confidenceScore: 96,
      signalAnalysis: 'Respect the timing objection and preserve the relationship with a specific Q4 follow-up reminder.',
      aiDraft: 'Understood — I’ll close the loop for now and reconnect at the start of Q4. Thanks for the clarity, David.',
      status: 'ARCHIVED',
      createdAt: minutesAgo(31),
      approvedAt: null,
      isHighPriority: false,
      sourceType: 'VSL_DEMO',
      signalType: 'EMAIL_REPLY',
    },
  ];

  const governanceSignals = [
    { key: 'sarah', name: 'Sarah Jenkins', company: 'TechFlow Enterprise', value: 50_000, score: 92 },
    { key: 'marcus', name: 'Marcus Thorne', company: 'Procre8', value: 40_000, score: 68 },
    { key: 'david', name: 'David Chen', company: 'Horizon Partners', value: 30_000, score: 12 },
  ] as const;

  await prisma.$transaction(async (tx) => {
    for (const signal of queueSignals) {
      const { sourceMessageId, ...data } = signal;
      await tx.inboundSignal.upsert({
        where: {
          userId_sourceMessageId: {
            userId: user.id,
            sourceMessageId,
          },
        },
        create: {
          userId: user.id,
          sourceMessageId,
          ...data,
        },
        update: data,
      });
    }

    const approvedAt = new Date();
    const createdAt = new Date(approvedAt.getTime() - REVIEW_LATENCY_MS);

    for (const signal of governanceSignals) {
      const sourceMessageId = `vsl-governance-${signal.key}`;
      const data = {
        prospectName: signal.name,
        prospectContext: `${signal.company} | VSL governance analytics companion`,
        prospectEmail: null,
        pipelineValue: signal.value,
        dealStage: 'Approved — Pipeline Protected',
        rawEmail: 'VSL analytics companion record.',
        intentRisk: 'Governance Protected',
        signals: [] as string[],
        intentType: signal.score >= 71 ? 'HOT' : signal.score >= 31 ? 'WARM' : 'COLD',
        intentScore: signal.score,
        confidenceScore: 95,
        signalAnalysis: 'Human review completed and pipeline value protected.',
        aiDraft: 'Approved governance response.',
        status: 'APPROVED',
        createdAt,
        approvedAt,
        isHighPriority: false,
        sourceType: 'VSL_GOVERNANCE_METRIC',
        signalType: 'ANALYTICS_COMPANION',
      };

      await tx.inboundSignal.upsert({
        where: {
          userId_sourceMessageId: {
            userId: user.id,
            sourceMessageId,
          },
        },
        create: { userId: user.id, sourceMessageId, ...data },
        update: data,
      });
    }

    await tx.governanceRule.deleteMany({
      where: { userId: user.id, trigger: { startsWith: VSL_RULE_PREFIX } },
    });

    const existingActiveRules = await tx.governanceRule.count({
      where: { userId: user.id, isActive: true },
    });
    const rulesToCreate = Math.max(0, 14 - existingActiveRules);

    if (rulesToCreate > 0) {
      await tx.governanceRule.createMany({
        data: Array.from({ length: rulesToCreate }, (_, index) => ({
          userId: user.id,
          ruleType: index % 2 === 0 ? 'objection_override' : 'approval_pattern',
          trigger: `${VSL_RULE_PREFIX} Rule ${String(index + 1).padStart(2, '0')}`,
          response: `Codified VSL governance response ${index + 1}.`,
          isActive: true,
        })),
      });
    }
  }, { maxWait: 15_000, timeout: 60_000 });

  const [queueCount, approvedAggregate, latencyRows, rulesCount] = await Promise.all([
    prisma.inboundSignal.count({
      where: {
        userId: user.id,
        sourceType: 'VSL_DEMO',
        status: { in: ['PENDING', 'ARCHIVED'] },
      },
    }),
    prisma.inboundSignal.aggregate({
      where: { userId: user.id, status: 'APPROVED' },
      _sum: { pipelineValue: true },
    }),
    prisma.inboundSignal.findMany({
      where: { userId: user.id, approvedAt: { not: null } },
      select: { createdAt: true, approvedAt: true },
    }),
    prisma.governanceRule.count({ where: { userId: user.id, isActive: true } }),
  ]);

  const averageLatencyMs = latencyRows.reduce((sum, row) => (
    sum + ((row.approvedAt?.getTime() ?? row.createdAt.getTime()) - row.createdAt.getTime())
  ), 0) / Math.max(1, latencyRows.length);

  console.log('VSL seed complete', {
    user: user.email,
    tier: user.tier,
    queueSignals: queueCount,
    dashboardDealsProtected: approvedAggregate._sum.pipelineValue ?? 0,
    dashboardAverageApprovalSeconds: averageLatencyMs / 1_000,
    activeGovernanceRules: rulesCount,
  });
}

main()
  .catch((error) => {
    console.error('VSL seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
