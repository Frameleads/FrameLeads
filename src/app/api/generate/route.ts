// Force Vercel to never cache this API endpoint at the edge:
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { enrichExistingLeadProspect, saveGeneratedLead } from '@/lib/prospects/persistence';
import { extractProspectMetadata } from '@/lib/prospects/metadata';
import { getBrainContext } from '@/lib/brain';
import { getPlaybookContext } from '@/lib/revenue-playbook';
import { getSalesConstitutionContext } from '@/lib/sales-constitution';
import { BUILT_IN_MARKET_PROFILES, buildMarketAwareGenerationPrompt, listMarketProfiles, resolveMarketProfile } from '@/lib/market-messaging';
import { getUserEntitlementTier } from '@/lib/auth-guard';
import { hasFeatureAccess, monthlyLeadQuotaForTier } from '@/lib/entitlements';
import { resolveScoutUser } from '@/lib/scout-data';
import Anthropic from '@anthropic-ai/sdk';
import {
  validateGeneratedChannels,
  forceCompliance,
  MAX_RETRIES,
  OUTBOUND_WORD_LIMIT,
  type PipelineContext,
} from '@/lib/word-count-gate';

const SYSTEM_PROMPT = `You are a careful B2B SDR writer. Keep copy human, peer-to-peer, concise, low-jargon, and low-pressure. Avoid fake empathy and generic openings. Email paragraph count and structure may vary with the supplied market presentation guidance.

Output ONLY valid JSON in this exact format:
{
"email": {
"subject": "2-3 word lowercase subject",
"paragraphs": ["Email body paragraphs. Adapt structure to the supplied market profile while preserving the selected sales objective."]
},
"linkedin": "Short, direct 2-3 sentence LinkedIn connection note/DM focusing on pipeline fragility.",
"coldCall": "Crisp 30-second conversational phone script: Opener -> Problem diagnosis -> Low-friction permission check.",
"whatsapp": "Ultra-concise 1-2 sentence direct message asking for permission to send the diagnostic audit link.",
"psLine": "A one-sentence P.S. offering a highly relevant, low-friction asset (like a visual case study or a brief technical breakdown) related to the specific bottleneck diagnosed in the email."
}

Use simple, clear language without corporate jargon. Do not add numerical details unless they exist in trusted input/context.

CRITICAL SYSTEM DIRECTIVES (STRICTLY ENFORCED):

1. Zero Hallucinated Context: The core pain point must be derived only from the incident field in TRUSTED PROSPECT INPUT (the supplied incident details). If incident is absent, do not invent a pain, event, software, metric, or monetary loss. If it mentions manual labor, discuss only that supplied operational issue. Do not assume specific software unless explicitly stated in incident.
1a. Only FrameLeads Brain entries marked VERIFIED can support company/product factual claims; other Brain entries may guide voice only.
2. Abolish Fake Empathy: You are forbidden from using generic B2B pleasantries. Do not start with phrases like "I noticed you are growing fast," or "Congrats on the scaling." The first sentence must immediately and cleanly address the operational reality extracted from the incident.
3. No Fabrication: Never invent financial values, performance metrics, software/tool usage, company facts, business events, pains, ROI, or offers. Use numbers only when present in trusted supplied input/context. If evidence is absent, omit the claim.

STRICT EMAIL SUBJECT FORMAT:
- Output the subject line exactly once, only in "email.subject", with no "Subject:" prefix.
- The rendered email format is the subject on the first line, followed by one blank line, then the email body.
- NEVER repeat the subject line in "email.paragraphs" or anywhere in the email body.
- DO NOT output the word "Subject:" inside the email body.

You are a strict JSON generator. Output ONLY a valid raw JSON object. Do not include markdown code blocks, preambles, or postscripts.`;

function extractJsonObject(rawText: string): any {
  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`Failed to locate JSON object in response: ${rawText}`);
  }
  
  const jsonString = cleaned.substring(firstBrace, lastBrace + 1);
  return JSON.parse(jsonString);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeEmailSubject(subject: unknown): string {
  if (typeof subject !== 'string') return '';
  return subject.replace(/^\s*subject\s*:\s*/i, '').trim();
}

function sanitizeLeadingEmailSubject(body: unknown, subject: string): string {
  if (typeof body !== 'string') return '';

  let sanitized = body.trimStart();
  const normalizedSubject = normalizeEmailSubject(subject);
  const labeledSubjectLine = /^subject\s*:\s*[^\r\n]*(?:\r?\n+|$)/i;
  const exactSubjectLine = normalizedSubject
    ? new RegExp(
        `^["'\\u201c\\u201d]?${escapeRegExp(normalizedSubject)}["'\\u201c\\u201d]?[ \\t]*(?:\\r?\\n+|$)`,
        'i'
      )
    : null;

  // Strip only contiguous leading subject lines. A legitimate mention of the
  // subject later in the email body remains untouched.
  for (let pass = 0; pass < 10; pass++) {
    const before = sanitized;
    sanitized = sanitized.replace(labeledSubjectLine, '').trimStart();
    if (exactSubjectLine) {
      sanitized = sanitized.replace(exactSubjectLine, '').trimStart();
    }
    if (sanitized === before) break;
  }

  return sanitized.trim();
}

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const userEmail = cookieStore.get('user_email')?.value;

    let {
      leads, 
      batch_id, 
      timestamp, 
      creditsUsed: _clientCreditsUsed = 0,
      tier: _clientTier = 'UNAUTHORIZED',
      force_regenerate, 
      regenerate,
      preferredCtaStyle = 'Self-Serve Audit Link',
      marketProfileOverride = null,
      listId = null,
      overwriteExisting = false,
      context = {}
    } = await req.json();

    const senderName = context.sender_name || 'Sender';
    const companyName = context.company_name || 'Our Company';

    if (!leads) {
      return NextResponse.json({ success: false, error: "Missing leads payload" }, { status: 400 });
    }

    const authenticatedUser = await resolveScoutUser(prisma, cookieStore.get('frameleads_session')?.value, userEmail);
    const currentUser = authenticatedUser ? await prisma.user.findUnique({
      where: { id: authenticatedUser.id }, select: { id: true, leadsProcessed: true },
    }) : null;
    if (!currentUser) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const currentUserId = currentUser.id;
    const tier = await getUserEntitlementTier(currentUserId);
    if (!hasFeatureAccess(tier, 'BASE_OUTBOUND'))
      return NextResponse.json({ error: 'FEATURE_LOCKED', feature: 'BASE_OUTBOUND', requiredTier: 'MICRO_PILOT' }, { status: 403 });
    const shouldOverwriteExisting = overwriteExisting === true || regenerate === true || force_regenerate === true;

    listId = typeof listId === 'string' ? listId.trim() : null;
    if (listId) {
      const ownedList = currentUser
        ? await prisma.leadList.findFirst({
            where: { id: listId, userId: currentUser.id },
            select: { id: true },
          })
        : null;
      if (!ownedList) {
        return NextResponse.json({ success: false, error: "Destination list not found." }, { status: 403 });
      }
    }

    const maxQuota = monthlyLeadQuotaForTier(tier);
    const remainingQuota = Math.max(0, maxQuota - currentUser.leadsProcessed);

    const getLeadLinkedInUrl = (lead: any) => {
      const value = lead.linkedin || lead.linkedInUrl || lead.linkedin_url;
      return typeof value === 'string' ? value.trim() : '';
    };
    const linkedInUrls = Array.from(new Set(leads.map(getLeadLinkedInUrl).filter(Boolean))) as string[];
    const existingRecords = currentUserId && linkedInUrls.length > 0
      ? await prisma.generatedLead.findMany({
          where: {
            userId: currentUserId,
            linkedInUrl: { in: linkedInUrls },
          },
          orderBy: { createdAt: 'desc' },
          include: { prospect: { select: { country: true } } },
        })
      : [];
    const existingByLinkedInUrl = new Map<string, (typeof existingRecords)[number]>();
    for (const record of existingRecords) {
      if (!record.linkedInUrl) continue;
      const current = existingByLinkedInUrl.get(record.linkedInUrl);
      if (!current || (listId && record.listId === listId && current.listId !== listId)) {
        existingByLinkedInUrl.set(record.linkedInUrl, record);
      }
    }

    const skippedCandidates: Array<{ existing: (typeof existingRecords)[number]; source: any }> = [];
    const generationCandidates: any[] = [];
    const handledLinkedInUrls = new Set<string>();
    for (const lead of leads) {
      const linkedInUrl = getLeadLinkedInUrl(lead);
      if (linkedInUrl && handledLinkedInUrls.has(linkedInUrl)) continue;
      if (linkedInUrl) handledLinkedInUrls.add(linkedInUrl);

      const existing = linkedInUrl ? existingByLinkedInUrl.get(linkedInUrl) : undefined;
      if (existing && !shouldOverwriteExisting) {
        skippedCandidates.push({ existing, source: lead });
      } else {
        generationCandidates.push(lead);
      }
    }

    const skippedLeads = await Promise.all(skippedCandidates.map(async ({ existing, source }) => {
      const metadata = extractProspectMetadata(source);
      if (Object.values(metadata).some(value => value !== null)) await enrichExistingLeadProspect(prisma, currentUserId, existing.id, metadata);
      const movedLead = await prisma.generatedLead.update({
        where: { id: existing.id },
        data: { listId: listId || null },
      });

      return {
        id: movedLead.id,
        lead_id: movedLead.id,
        first_name: [movedLead.firstName, movedLead.lastName].filter(Boolean).join(' '),
        company_name: movedLead.companyName,
        website_url: movedLead.websiteUrl,
        linkedin_url: movedLead.linkedInUrl,
        email: movedLead.email,
        listId: movedLead.listId,
        provided_incident_details: movedLead.incidentDetails,
        enrichment_status: "completed",
        generation_status: "completed",
        generated_email: { body: movedLead.emailDraft },
        generated_linkedin: { body: movedLead.linkedInDraft },
        generated_script: movedLead.coldCallDraft ? { body: movedLead.coldCallDraft } : null,
        generated_whatsapp: movedLead.whatsAppDraft ? { body: movedLead.whatsAppDraft } : null,
        deployment_status: "pending",
        skipped_existing: true,
      };
    }));

    const allowedLeads = generationCandidates.slice(0, remainingQuota);
    const lockedLeads = generationCandidates.slice(remainingQuota);

    const apiKey = process.env.ANTHROPIC_API_KEY || "";
    let processedLeads: any[] = [...skippedLeads];

    if (allowedLeads.length > 0 && apiKey) {
      const anthropic = new Anthropic({ apiKey });
      const [brain, playbook, constitution, marketProfiles] = await Promise.all([
        hasFeatureAccess(tier, 'BRAIN') ? getBrainContext({ userId: currentUserId, purpose: 'outbound', maxEntries: 8, maxCharacters: 650 }, prisma) : Promise.resolve({ contextText: '' }),
        hasFeatureAccess(tier, 'PLAYBOOK') ? getPlaybookContext({ userId: currentUserId, purpose: 'outbound', maxRules: 4, maxCharacters: 550 }, prisma) : Promise.resolve({ contextText: '' }),
        getSalesConstitutionContext({ userId: currentUserId, purpose: 'outbound', maxRules: 4, maxCharacters: 550 }, prisma),
        hasFeatureAccess(tier, 'CUSTOM_MARKET_PROFILES') ? listMarketProfiles(currentUserId, prisma) : Promise.resolve([]),
      ]);

      const generatedLeads = await Promise.all(
        allowedLeads.map(async (lead: any, index: number) => {
          try {
            const uniqueSeed = `seed_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

            const savedLead = lead.lead_id ? existingByLinkedInUrl.get(getLeadLinkedInUrl(lead)) : undefined;
            const marketRequestedLeadId = regenerate === true && typeof (lead.lead_id || lead.id) === 'string' ? (lead.lead_id || lead.id) as string : null;
            const ownedLead = marketRequestedLeadId ? await prisma.generatedLead.findFirst({ where: { id: marketRequestedLeadId, userId: currentUserId },
              include: { prospect: { select: { country: true } } } }) : null;
            if (marketRequestedLeadId && !ownedLead) throw new Error('Regeneration lead is not owned by authenticated user');
            const metadata = extractProspectMetadata(lead);
            const country = ownedLead?.prospect?.country || savedLead?.prospect?.country || metadata.country;
            const allowedOverride = hasFeatureAccess(tier, 'CUSTOM_MARKET_PROFILES') || (typeof marketProfileOverride === 'string' && BUILT_IN_MARKET_PROFILES.some(profile => profile.key === marketProfileOverride))
              ? marketProfileOverride : null;
            const marketProfile = await resolveMarketProfile({ userId: currentUserId, country, override: allowedOverride,
              profiles: marketProfiles }, prisma);
            const factualLead = { name: [lead.first_name, lead.last_name].filter(Boolean).join(' '),
              company: lead.company_name || null, incident: lead.provided_incident_details || lead.incident_details || null,
              jobTitle: metadata.jobTitle, industry: metadata.industry, country, location: metadata.location,
              companySizeMin: metadata.companySizeMin, companySizeMax: metadata.companySizeMax };
            const prompt = buildMarketAwareGenerationPrompt({ brain: brain.contextText, playbook: playbook.contextText,
              constitution: constitution.contextText, profile: marketProfile, prospect: factualLead,
              preferredCtaStyle: String(preferredCtaStyle), seed: uniqueSeed, wordLimit: OUTBOUND_WORD_LIMIT });
            // â”€â”€ WORD-COUNT GATE: Retry loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            const pipelineContext: PipelineContext = 'outbound';
            let generated: any = null;
            let attempt = 0;
            let lastValidation = null;

            while (attempt <= MAX_RETRIES) {
              const retryPrompt = attempt === 0
                ? prompt
                : `${prompt}\n\nPREVIOUS ATTEMPT EXCEEDED WORD LIMITS. You MUST keep each channel body STRICTLY under ${OUTBOUND_WORD_LIMIT} words. Be more concise.`;

              const response = await anthropic.messages.create({
                model: 'claude-haiku-4-5',
                max_tokens: 1024,
                temperature: 0.7,
                system: SYSTEM_PROMPT,
                messages: [{ role: 'user', content: retryPrompt }]
              });
              
              const responseText = (response.content[0] as any).text;
              generated = extractJsonObject(responseText);

              // Inject the array-hack join logic before validation
              if (generated.email && Array.isArray(generated.email.paragraphs)) {
                generated.email.body = generated.email.paragraphs.join('\n\n');
              }
              if (generated.email && typeof generated.email === 'object') {
                generated.email.subject = normalizeEmailSubject(generated.email.subject);
                generated.email.body = sanitizeLeadingEmailSubject(
                  generated.email.body,
                  generated.email.subject
                );
              }
              // Prevent crashes during validation if the LLM drops these keys based on the rigid prompt
              generated.linkedin = generated.linkedin || { body: "" };
              generated.coldCall = generated.coldCall || { body: "" };
              generated.whatsapp = generated.whatsapp || { body: "" };

              lastValidation = validateGeneratedChannels(generated, pipelineContext);

              if (lastValidation.allPassed) {
                break;
              }

              console.warn(
                `[WORD-COUNT GATE] Attempt ${attempt + 1}/${MAX_RETRIES + 1} FAILED for ${lead.company_name}. ` +
                `Email: ${lastValidation.email.wordCount}w, ` +
                `LinkedIn: ${lastValidation.linkedin.wordCount}w, ` +
                `ColdCall: ${lastValidation.coldCall.wordCount}w, ` +
                `WhatsApp: ${lastValidation.whatsapp.wordCount}w`
              );

              attempt++;
            }

            if (lastValidation && !lastValidation.allPassed) {
              console.warn(
                `[WORD-COUNT GATE] All retries exhausted for ${lead.company_name}. Force-truncating to ${OUTBOUND_WORD_LIMIT} words.`
              );
              generated = forceCompliance(generated);
            }

            if (generated.email && generated.email.body) {
              generated.email.subject = normalizeEmailSubject(generated.email.subject);
              generated.email.body = sanitizeLeadingEmailSubject(
                generated.email.body,
                generated.email.subject
              );
              const rawPsLine = generated.psLine || "Here is a quick visual breakdown of this architecture in action.";
              const cleanPsLine = rawPsLine.replace(/^(P\.S\.|PS:|P\.S|PS)\s*/i, '').trim();
              const finalEmailBody = `${generated.email.body}\n\nBest,\n${senderName}\n${companyName}\n\nP.S. ${cleanPsLine}`;
              generated.email.body = finalEmailBody;
            }

            const finalEmailBody = typeof generated.email?.body === 'string'
              ? generated.email.body
              : '';
            const finalLinkedInBody = typeof generated.linkedin === 'string'
              ? generated.linkedin
              : typeof generated.linkedin?.body === 'string'
                ? generated.linkedin.body
                : '';
            const finalColdCallBody = typeof generated.coldCall === 'string'
              ? generated.coldCall
              : typeof generated.coldCall?.body === 'string'
                ? generated.coldCall.body
                : '';
            const finalWhatsAppBody = typeof generated.whatsapp === 'string'
              ? generated.whatsapp
              : typeof generated.whatsapp?.body === 'string'
                ? generated.whatsapp.body
                : '';

            let persistedLeadId: string | null = null;

            if (currentUserId) {
              const requestedLeadId = regenerate === true && typeof (lead.lead_id || lead.id) === 'string'
                ? (lead.lead_id || lead.id) as string : null;
              const ownedRegenerationLead = requestedLeadId
                ? await prisma.generatedLead.findFirst({ where: { id: requestedLeadId, userId: currentUserId } }) : null;
              if (requestedLeadId && !ownedRegenerationLead) throw new Error('Regeneration lead is not owned by authenticated user');
              const firstName = ownedRegenerationLead?.firstName || lead.raw_first_name || lead.first_name || lead.firstName || 'Unknown';
              const lastName = ownedRegenerationLead?.lastName ?? lead.last_name ?? lead.lastName ?? '';
              const companyName = ownedRegenerationLead?.companyName || lead.company_name || lead.companyName || 'Unknown Company';
              const websiteUrl = ownedRegenerationLead?.websiteUrl || lead.website_url || lead.websiteUrl || null;
              const email = ownedRegenerationLead?.email || lead.email || lead.email_address || lead.emailAddress || null;
              const linkedInUrl = ownedRegenerationLead?.linkedInUrl || getLeadLinkedInUrl(lead);
              const rawScore = lead.score == null ? null : Number(lead.score);
              const score = ownedRegenerationLead?.score ?? (rawScore !== null && Number.isInteger(rawScore) ? rawScore : null);
              const safeLinkedInUrl = linkedInUrl !== ''
                ? linkedInUrl
                : `missing-url-${Date.now()}-${Math.random()}`;
              const existingLead = ownedRegenerationLead || (linkedInUrl ? existingByLinkedInUrl.get(linkedInUrl) : undefined);

              const persistedLead = await saveGeneratedLead(prisma, {
                userId: currentUserId,
                firstName,
                lastName,
                linkedInUrl: safeLinkedInUrl,
                companyName,
                websiteUrl,
                email,
                score,
                targetGroup: ownedRegenerationLead?.targetGroup || lead.target_group || lead.targetGroup || context.target_audience || null,
                incidentDetails: ownedRegenerationLead?.incidentDetails || lead.incident_details || lead.incidentDetails || lead.provided_incident_details || null,
                emailDraft: finalEmailBody,
                linkedInDraft: finalLinkedInBody,
                coldCallDraft: finalColdCallBody || null,
                whatsAppDraft: finalWhatsAppBody || null,
                listId: listId || ownedRegenerationLead?.listId || null,
              }, existingLead?.id, extractProspectMetadata(lead));
              persistedLeadId = persistedLead.id;
            }

            const responseLeadId = persistedLeadId || lead.id || lead.lead_id || `lead_gen_${index}_${Date.now()}`;

            return {
              id: responseLeadId,
              lead_id: responseLeadId,
              first_name: lead.first_name || "Unknown",
              company_name: lead.company_name || "Unknown Company",
              website_url: lead.website_url || null,
              linkedin_url: lead.linkedin_url || lead.linkedInUrl || lead.linkedin || null,
              email: lead.email || lead.email_address || lead.emailAddress || null,
              listId: listId || lead.listId || null,
              provided_incident_details: "Generated based on visceral architecture.",
              enrichment_status: "completed",
              generation_status: "completed",
              generated_email: generated.email || { body: "" },
              generated_linkedin: generated.linkedin || { body: "" },
              generated_script: generated.coldCall || { body: "" },
              generated_whatsapp: generated.whatsapp || { body: "" },
              marketProfile,
              deployment_status: "pending"
            };
          } catch (e) {
            console.error(`Claude Generation Error on lead [${lead.company_name}]:`, e);
            throw e;
          }
        })
      );
      processedLeads = [...processedLeads, ...generatedLeads];
    } else if (allowedLeads.length > 0) {
      return NextResponse.json(
        { success: false, error: "Missing Anthropic API Key" },
        { status: 401 }
      );
    }

    const ghostLeads = lockedLeads.map((lead: any, index: number) => ({
      lead_id: lead.lead_id || `lead_locked_${index}_${Date.now()}`,
      first_name: lead.first_name || "Unknown",
      company_name: lead.company_name || "Unknown Company",
      website_url: lead.website_url || null,
      email: lead.email || lead.email_address || lead.emailAddress || null,
      provided_incident_details: "Generated based on visceral architecture.",
      enrichment_status: "completed",
      generation_status: "quota_locked",
      generated_email: { 
        subject: "upgrade to unlock", 
        body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur." 
      },
      generated_linkedin: { body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua." },
      generated_script: { body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit." },
      generated_whatsapp: { body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit." },
      deployment_status: "pending"
    }));

    processedLeads = [...processedLeads, ...ghostLeads];

    if (userEmail && allowedLeads.length > 0) {
      await prisma.user.update({
        where: { email: userEmail },
        data: { leadsProcessed: { increment: allowedLeads.length } }
      });
    }

    const batchResponse = {
      batch_id: batch_id || `batch_${Date.now()}`,
      status: "completed",
      leads: processedLeads,
      processed_count: processedLeads.length,
      error_message: null
    };

    return NextResponse.json(batchResponse, { status: 200 });

  } catch (error: any) {
    console.error("API Generation Failure:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Catastrophic failure inside the generation pipeline." },
      { status: 500 }
    );
  }
}
