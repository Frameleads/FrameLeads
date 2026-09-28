import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { identityTransaction, attachableProspectId } from '@/lib/prospects/identity';
import { leadProspectInTransaction } from '@/lib/prospects/persistence';

interface DuplicateListRouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: DuplicateListRouteContext) {
  try {
    const cookieStore = await cookies();
    const email = cookieStore.get("user_email")?.value;
    const user = email
      ? await prisma.user.findUnique({
          where: { email: email.trim().toLowerCase() },
          select: { id: true },
        })
      : null;

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const sourceList = await prisma.leadList.findFirst({
      where: { id, userId: user.id },
      include: { leads: { where: { userId: user.id } } },
    });
    if (!sourceList) {
      return NextResponse.json({ success: false, error: "List not found." }, { status: 404 });
    }

    const duplicatedList = await identityTransaction(prisma, async (transaction) => {
      const newList = await transaction.leadList.create({
        data: {
          name: `${sourceList.name} (Copy)`,
          userId: user.id,
        },
      });

      if (sourceList.leads.length > 0) {
        const linkedLeads = [];
        for (const lead of sourceList.leads) {
          const result = await leadProspectInTransaction(transaction, lead);
          linkedLeads.push({ ...lead, prospectId: attachableProspectId(result, user.id) });
        }
        await transaction.generatedLead.createMany({
          data: linkedLeads.map((lead) => ({
            userId: user.id,
            prospectId: lead.prospectId,
            firstName: lead.firstName,
            lastName: lead.lastName,
            linkedInUrl: lead.linkedInUrl,
            companyName: lead.companyName,
            websiteUrl: lead.websiteUrl,
            email: lead.email,
            score: lead.score,
            targetGroup: lead.targetGroup,
            incidentDetails: lead.incidentDetails,
            emailDraft: lead.emailDraft,
            linkedInDraft: lead.linkedInDraft,
            coldCallDraft: lead.coldCallDraft,
            whatsAppDraft: lead.whatsAppDraft,
            listId: newList.id,
          })),
        });
      }

      return newList;
    });

    return NextResponse.json({
      success: true,
      list: duplicatedList,
      duplicatedCount: sourceList.leads.length,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to duplicate lead list:", error);
    return NextResponse.json({ success: false, error: "Failed to duplicate list." }, { status: 500 });
  }
}
