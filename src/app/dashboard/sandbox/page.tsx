export const dynamic = 'force-dynamic';

import { cookies } from "next/headers";
import SandboxClient from "./SandboxClient";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

const LEADS_PER_PAGE = 50;

interface SandboxPageProps {
  searchParams: Promise<{
    page?: string | string[];
    q?: string | string[];
    list?: string | string[];
  }>;
}

export default async function SandboxPage({ searchParams }: SandboxPageProps) {
  const cookieStore = await cookies();
  const email = cookieStore.get('user_email')?.value;
  
  if (!email) {
    return <div>Unauthorized</div>;
  }

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, tier: true, monthlyQuota: true, leadsProcessed: true }
  });

  if (!user) {
    return <div>User not found</div>;
  }

  const params = await searchParams;
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const rawListId = Array.isArray(params.list) ? params.list[0] : params.list;
  const requestedPage = Math.max(1, Number.parseInt(rawPage || '1', 10) || 1);
  const query = rawQuery?.trim() || '';
  const listId = rawListId?.trim() || '';

  const where: Prisma.GeneratedLeadWhereInput = {
    userId: user.id,
    ...(listId ? { listId } : {}),
    ...(query
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
    orderBy: { createdAt: 'desc' },
    take: 50,
    skip: (currentPage - 1) * LEADS_PER_PAGE,
  });

  const initialLeads = generatedLeads.map((lead) => ({
    id: lead.id,
    lead_id: lead.id,
    first_name: [lead.firstName, lead.lastName].filter(Boolean).join(' '),
    raw_first_name: lead.firstName,
    last_name: lead.lastName,
    company_name: lead.companyName,
    website_url: lead.websiteUrl,
    linkedin_url: lead.linkedInUrl,
    linkedInUrl: lead.linkedInUrl,
    listId: lead.listId,
    score: lead.score,
    target_group: lead.targetGroup,
    created_at: lead.createdAt.toISOString(),
    provided_incident_details: lead.incidentDetails,
    enrichment_status: 'completed',
    generation_status: 'completed',
    generated_email: { body: lead.emailDraft },
    generated_linkedin: { body: lead.linkedInDraft },
    coldCallDraft: lead.coldCallDraft,
    whatsAppDraft: lead.whatsAppDraft,
    generated_script: lead.coldCallDraft ? { body: lead.coldCallDraft } : null,
    generated_whatsapp: lead.whatsAppDraft ? { body: lead.whatsAppDraft } : null,
    deployment_status: 'pending',
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
