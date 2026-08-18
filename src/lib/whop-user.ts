import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { WhopSubscription } from "@/lib/whop-subscription";

type MergeWhopUserInput = {
  whopId: string;
  email: string;
  subscription: WhopSubscription;
};

function isRetryableConflict(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  const code = (error as { code?: string }).code;
  return code === "P2002" || code === "P2034";
}

/**
 * Creates or merges a Whop user without racing the OAuth callback against
 * membership/payment webhooks.
 *
 * Serializable transactions make the read-then-create sequence atomic. A
 * concurrent request can still be selected as the transaction loser, so
 * Prisma's serialization (P2034) and unique-key (P2002) conflicts are retried.
 * Every caller must supply a verified paid subscription. This prevents user
 * records from being created without a recognized FrameLeads entitlement.
 */
export async function mergeWhopUser({
  whopId,
  email,
  subscription,
}: MergeWhopUserInput) {
  const normalizedEmail = email.trim().toLowerCase();
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existingUser = await tx.user.findFirst({
            where: { OR: [{ whopId }, { email: normalizedEmail }] },
          });

          if (existingUser) {
            return tx.user.update({
              where: { id: existingUser.id },
              data: {
                whopId,
                email: normalizedEmail,
                ...subscription,
              },
            });
          }

          return tx.user.create({
            data: {
              whopId,
              email: normalizedEmail,
              tier: subscription.tier,
              monthlyQuota: subscription.monthlyQuota,
              leadsProcessed: 0,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isRetryableConflict(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }

  // The loop either returns a user or throws on its final attempt.
  throw new Error("Unable to merge Whop user");
}
