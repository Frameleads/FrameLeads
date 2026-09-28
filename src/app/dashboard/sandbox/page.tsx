export const dynamic = 'force-dynamic';

import { cookies } from "next/headers";
import SandboxClient from "./SandboxClient";
import { prisma } from "@/lib/prisma";
import { resolveScoutUser } from "@/lib/scout-data";
import type { Prisma } from "@prisma/client";

const LEADS_PER_PAGE = 50;

interface SandboxPageProps {
  searchParams: Promise<{
    page?: string | string[];
    q?: string | string[];
    list?: string | string[];
    lead?: string | string[];
  }>;
}

export default async function SandboxPage({ searchParams }: SandboxPageProps) {
  const cookieStore = await cookies();
  const email = cookieStore.get('user_email')?.value;
  
  const authenticated = await resolveScoutUser(prisma, cookieStore.get('frameleads_session')?.value, email);
  if (!authenticated) {
    return <div>Unauthorized</div>;
  }

  const user = await prisma.user.findUnique({
    where: { id: authenticated.id },
    select: { id: true, tier: true, monthlyQuota: true, leadsProcessed: true }
  });

  if (!user) {
    return <div>User not found</div>;
  }

  const params = await searchParams;
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const rawListId = Array.isArray(params.list) ? params.list[0] : params.list;
  const rawLeadId = Array.isArray(params.lead) ? params.lead[0] : params.lead;
  const requestedPage = Math.max(1, Number.parseInt(rawPage || '1', 10) || 1);
  const query = rawQuery?.trim() || '';
  const listId = rawListId?.trim() || '';
  const leadId = rawLeadId?.trim().slice(0, 128) || '';

  const where: Prisma.GeneratedLeadWhereInput = {
    userId: user.id,
    ...(leadId ? { id: leadId } : listId ? { listId } : {}),
    ...(!leadId && query
      ? {
          OR: [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { companyName: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const totalCount = await prisma.generatedLead.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalCount / LEADS_PER_PAGE));
  const currentPage = Math.min(requestedPage, totalPages);
  const generatedLeads = await prisma.generatedLead.findMany({
    where,
    include: { prospect: { select: {
      id: true, jobTitle: true, industry: true, country: true, companyId: true,
      intelligence: { select: { researchStatus: true, fitScore: true, fitTier: true, whyFit: true, whyNow: true, triggers: true, risks: true } },
    } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    skip: (currentPage - 1) * LEADS_PER_PAGE,
  });

  const initialLeads = generatedLeads.map((lead) => ({
    id: lead.id,
    lead_id: lead.id,
    first_name: [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unnamed prospect',
    raw_first_name: lead.firstName,
    last_name: lead.lastName,
    company_name: lead.companyName || 'Company unknown',
    website_url: lead.websiteUrl,
    linkedin_url: lead.linkedInUrl,
    linkedInUrl: lead.linkedInUrl,
    email: lead.email,
    listId: lead.listId,
    score: lead.score,
    target_group: lead.targetGroup,
    created_at: lead.createdAt.toISOString(),
    provided_incident_details: lead.incidentDetails,
    enrichment_status: 'completed',
    generation_status: lead.emailDraft || lead.linkedInDraft ? 'completed' : 'not_generated',
    generated_email: lead.emailDraft ? { body: lead.emailDraft } : null,
    generated_linkedin: lead.linkedInDraft ? { body: lead.linkedInDraft } : null,
    coldCallDraft: lead.coldCallDraft,
    whatsAppDraft: lead.whatsAppDraft,
    generated_script: lead.coldCallDraft ? { body: lead.coldCallDraft } : null,
    generated_whatsapp: lead.whatsAppDraft ? { body: lead.whatsAppDraft } : null,
    deployment_status: 'pending',
    scout: lead.prospect?.intelligence?.researchStatus === 'READY' ? {
      prospectId: lead.prospect.id,
      companyId: lead.prospect.companyId,
      jobTitle: lead.prospect.jobTitle,
      industry: lead.prospect.industry,
      country: lead.prospect.country,
      fitScore: lead.prospect.intelligence.fitScore,
      fitTier: lead.prospect.intelligence.fitTier,
      whyFit: lead.prospect.intelligence.whyFit,
      whyNow: lead.prospect.intelligence.whyNow,
      trigger: lead.prospect.intelligence.triggers[0] || null,
      risk: lead.prospect.intelligence.risks[0] || null,
    } : null,
  }));

  return (
    <SandboxClient
      leadsProcessed={user.leadsProcessed}
      monthlyQuota={user.monthlyQuota}
      userTier={user.tier}
      initialLeads={initialLeads}
      currentPage={currentPage}
      totalPages={totalPages}
      totalCount={totalCount}
      initialQuery={query}
    />
  );
}
