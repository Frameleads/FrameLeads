import { ProspectEvidenceType, type PrismaClient, type Prospect } from '@prisma/client';

export type ResearchEvidence = {
  evidenceId: string;
  evidenceType: ProspectEvidenceType;
  sourceTitle: string;
  sourceUrl: string | null;
  content: string;
  capturedAt: string;
  /** Only direct user evidence can establish a verified timing signal in this first adapter. */
  timingEligible: boolean;
  substantive: boolean;
  persistedUserEvidenceId?: string;
};

/** Future website adapters must validate public destinations, redirects, DNS, timeout, MIME type, and response size. No live adapter is installed in Phase 1C. */
export interface WebsiteEvidenceAdapter {
  collectPublicCompanyPages(websiteUrl: string): Promise<ResearchEvidence[]>;
}

const MAX_EVIDENCE = 12;
const MAX_SOURCE_CHARS = 1000;
const POSITIVE_TIMING_LANGUAGE = /\b(?:(?:is|are) (?:currently |actively )?hiring|(?:active|currently active) (?:outbound )?hiring|(?:currently|actively) expanding|(?:is|are) launching|launched this (?:week|month|quarter)|deadline (?:on|in)\b)/i;
const NEGATED_TIMING_LANGUAGE = /\b(?:not|no|isn't|aren't|without) (?:currently |actively )?(?:hiring|expanding|launching)\b/i;

function hasExplicitTimingSignal(content: string): boolean {
  return POSITIVE_TIMING_LANGUAGE.test(content) && !NEGATED_TIMING_LANGUAGE.test(content);
}

export function sanitizeEvidenceText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SOURCE_CHARS);
}

export function isGroundedClaim(claim: string, sourceContent: string): boolean {
  const normalizedClaim = sanitizeEvidenceText(claim).toLocaleLowerCase('en-US');
  const normalizedSource = sanitizeEvidenceText(sourceContent).toLocaleLowerCase('en-US');
  return normalizedClaim.length >= 8 && normalizedSource.includes(normalizedClaim);
}

export async function collectProspectEvidence(
  db: PrismaClient,
  prospect: Pick<Prospect, 'id' | 'userId' | 'companyName' | 'createdAt'>,
  intelligenceId?: string,
): Promise<ResearchEvidence[]> {
  const evidence: ResearchEvidence[] = [];
  const add = (source: ResearchEvidence) => {
    const content = sanitizeEvidenceText(source.content);
    if (content && evidence.length < MAX_EVIDENCE) evidence.push({ ...source, content });
  };

  // Existing user evidence comes first. Prior AI-generated evidence is excluded to avoid self-citation.
  if (intelligenceId) {
    const userEvidence = await db.prospectEvidence.findMany({
      where: { userId: prospect.userId, prospectIntelligenceId: intelligenceId, isUserProvided: true },
      orderBy: { capturedAt: 'desc' }, take: 8,
      select: { id: true, evidenceType: true, sourceTitle: true, sourceUrl: true, claim: true, capturedAt: true },
    });
    for (const row of userEvidence) {
      add({
        evidenceId: `user:${row.id}`,
        evidenceType: row.evidenceType,
        sourceTitle: row.sourceTitle,
        sourceUrl: row.sourceUrl,
        content: row.claim,
        capturedAt: row.capturedAt.toISOString(),
        timingEligible: hasExplicitTimingSignal(row.claim),
        substantive: true,
        persistedUserEvidenceId: row.id,
      });
    }
  }

  if (prospect.companyName?.trim()) {
    add({
      evidenceId: `prospect:${prospect.id}:company`, evidenceType: ProspectEvidenceType.INTERNAL,
      sourceTitle: 'Prospect record', sourceUrl: null,
      content: `Recorded company name: ${prospect.companyName}.`,
      capturedAt: prospect.createdAt.toISOString(), timingEligible: false, substantive: false,
    });
  }

  const leads = await db.generatedLead.findMany({
    where: { userId: prospect.userId, prospectId: prospect.id },
    orderBy: { createdAt: 'desc' }, take: 4,
    select: { id: true, targetGroup: true, incidentDetails: true, createdAt: true },
  });
  for (const lead of leads) {
    if (lead.targetGroup?.trim()) add({
      evidenceId: `lead:${lead.id}:target`, evidenceType: ProspectEvidenceType.INTERNAL,
      sourceTitle: 'Campaign target group', sourceUrl: null,
      content: `Campaign target group: ${lead.targetGroup}.`,
      capturedAt: lead.createdAt.toISOString(), timingEligible: false, substantive: true,
    });
    if (lead.incidentDetails?.trim()) add({
      evidenceId: `lead:${lead.id}:incident`, evidenceType: ProspectEvidenceType.INTERNAL,
      sourceTitle: 'Lead context (unverified)', sourceUrl: null,
      content: `Lead context, not independently verified: ${lead.incidentDetails}.`,
      capturedAt: lead.createdAt.toISOString(), timingEligible: false, substantive: true,
    });
  }
  return evidence;
}
