// Force Vercel to never cache this API endpoint at the edge:
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import Anthropic from '@anthropic-ai/sdk';
import {
  validateGeneratedChannels,
  forceCompliance,
  MAX_RETRIES,
  OUTBOUND_WORD_LIMIT,
  type PipelineContext,
} from '@/lib/word-count-gate';

const SYSTEM_PROMPT = `You are a B2B sales assistant. Your job is to fill in the blanks of a strict email template.
Do NOT use any corporate jargon. Use 6th-grade English.

Output ONLY valid JSON in this exact format:
{
"email": {
"subject": "2-3 word lowercase subject",
"paragraphs": [
"I noticed you are scaling the team at {company_name}.",
"The trap most founders fall into here is manual CRM work, which actively burns [INVENT A SPECIFIC NUMERICAL METRIC: e.g., $40k/month, 11 hours/week] in lost pipeline.",
"We built a triage architecture that governs this autonomously, dropping response times to under 5 minutes without adding payroll.",
"Opposed to taking a look at the sandbox?"
]
},
"linkedin": "Short, direct 2-3 sentence LinkedIn connection note/DM focusing on pipeline fragility.",
"coldCall": "Crisp 30-second conversational phone script: Opener -> Problem diagnosis -> Low-friction permission check.",
"whatsapp": "Ultra-concise 1-2 sentence direct message asking for permission to send the diagnostic audit link.",
"psLine": "A one-sentence P.S. offering a highly relevant, low-friction asset (like a visual case study or a brief technical breakdown) related to the specific bottleneck diagnosed in the email."
}

Ensure all four channels adhere to our core copy principles: 6th-grade English, concrete metrics ($15k–$67k loss / Zapier timeout errors), and zero corporate jargon.

CRITICAL SYSTEM DIRECTIVES (STRICTLY ENFORCED):

1. Zero Hallucinated Context: The core pain point you address MUST be 100% derived from the [Incident_Details] variable. If the incident details mention manual labor, you only discuss the pain of manual labor. DO NOT invent, assume, or hallucinate that the prospect uses specific software (e.g., Zapier, Make, Hubspot, Salesforce) unless it is explicitly stated in the incident.
2. Abolish Fake Empathy: You are forbidden from using generic B2B pleasantries. Do not start with phrases like "I noticed you are growing fast," or "Congrats on the scaling." The first sentence must immediately and cleanly address the operational reality extracted from the incident.
3. No Fabricated Math: Do not invent specific monetary losses (e.g., "$28k/month"). Instead, frame the loss through universal operational metrics, such as "silent pipeline decay," "unnecessary manual overhead," or "wasted hours in triage," unless a specific dollar amount is provided in the raw data.

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
      creditsUsed = 0, 
      tier = 'UNAUTHORIZED',
      force_regenerate, 
      regenerate,
      preferredCtaStyle = 'Self-Serve Audit Link',
      listId = null,
      overwriteExisting = false,
      context = {}
    } = await req.json();

    const senderName = context.sender_name || 'Sender';
    const companyName = context.company_name || 'Our Company';

    if (!leads) {
      return NextResponse.json({ success: false, error: "Missing leads payload" }, { status: 400 });
    }

    const currentUser = userEmail
      ? await prisma.user.findUnique({
          where: { email: userEmail.trim().toLowerCase() },
          select: { id: true },
        })
      : null;
    const currentUserId = currentUser?.id || userEmail?.trim().toLowerCase();
    const shouldOverwriteExisting = overwriteExisting === true;

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

    const maxQuota = tier === 'ENTERPRISE' ? 20000 : tier === 'CORE' ? 500 : tier === 'MICRO_PILOT' ? 25 : 0;
    
    const remainingQuota = Math.max(0, maxQuota - (Number(creditsUsed) || 0));

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

    const skippedCandidates: Array<{ existing: (typeof existingRecords)[number] }> = [];
    const generationCandidates: any[] = [];
    const handledLinkedInUrls = new Set<string>();
    for (const lead of leads) {
      const linkedInUrl = getLeadLinkedInUrl(lead);
      if (linkedInUrl && handledLinkedInUrls.has(linkedInUrl)) continue;
      if (linkedInUrl) handledLinkedInUrls.add(linkedInUrl);

      const existing = linkedInUrl ? existingByLinkedInUrl.get(linkedInUrl) : undefined;
      if (existing && !shouldOverwriteExisting) {
        skippedCandidates.push({ existing });
      } else {
        generationCandidates.push(lead);
      }
    }

    const skippedLeads = await Promise.all(skippedCandidates.map(async ({ existing }) => {
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

      const generatedLeads = await Promise.all(
        allowedLeads.map(async (lead: any, index: number) => {
          try {
            const uniqueSeed = `seed_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

            const prompt = `Generate outreach for:
Name: ${lead.first_name || 'Founder'}
Company: ${lead.company_name || 'Unknown'}
Context: We provide autonomous AI acquisition infrastructure.
Preferred CTA Style: "${preferredCtaStyle}"
Unique Generation Seed: ${uniqueSeed}
CRITICAL DIRECTIVE: Write a completely original, fresh variation. Do not repeat previous sentence structures. End EVERY channel script with a CTA that strictly matches: "${preferredCtaStyle}". Ensure you use a No-Oriented/Permission-based question.
WORD LIMIT: Each channel body MUST be under ${OUTBOUND_WORD_LIMIT} words. This is a hard constraint.`;

            // ── WORD-COUNT GATE: Retry loop ─────────────────────────
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
              const firstName = lead.first_name || lead.firstName || 'Unknown';
              const lastName = lead.last_name || lead.lastName || '';
              const companyName = lead.company_name || lead.companyName || 'Unknown Company';
              const websiteUrl = lead.website_url || lead.websiteUrl || null;
              const email = lead.email || lead.email_address || lead.emailAddress || null;
              const linkedInUrl = getLeadLinkedInUrl(lead);
              const rawScore = lead.score == null ? null : Number(lead.score);
              const score = rawScore !== null && Number.isInteger(rawScore) ? rawScore : null;
              const safeLinkedInUrl = linkedInUrl !== ''
                ? linkedInUrl
                : `missing-url-${Date.now()}-${Math.random()}`;
              const existingLead = linkedInUrl
                ? existingByLinkedInUrl.get(linkedInUrl)
                : undefined;

              const persistedLead = existingLead
                ? await prisma.generatedLead.update({
                    where: { id: existingLead.id },
                    data: {
                      firstName,
                      lastName,
                      companyName,
                      websiteUrl,
                      email,
                      score,
                      targetGroup: lead.target_group || lead.targetGroup || context.target_audience || null,
                      incidentDetails: lead.incident_details || lead.incidentDetails || lead.provided_incident_details || null,
                      emailDraft: finalEmailBody,
                      linkedInDraft: finalLinkedInBody,
                      coldCallDraft: finalColdCallBody || null,
                      whatsAppDraft: finalWhatsAppBody || null,
                      listId: listId || null,
                      createdAt: new Date(),
                    },
                  })
                : await prisma.generatedLead.create({
                    data: {
                      userId: currentUserId,
                      firstName,
                      lastName,
                      linkedInUrl: safeLinkedInUrl,
                      companyName,
                      websiteUrl,
                      email,
                      score,
                      targetGroup: lead.target_group || lead.targetGroup || context.target_audience || null,
                      incidentDetails: lead.incident_details || lead.incidentDetails || lead.provided_incident_details || null,
                      emailDraft: finalEmailBody,
                      linkedInDraft: finalLinkedInBody,
                      coldCallDraft: finalColdCallBody || null,
                      whatsAppDraft: finalWhatsAppBody || null,
                      listId: listId || null,
                    },
                  });
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
