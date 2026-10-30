// Explicit, audited opt-in AFTER migration/code/impact review. Dry-run by default.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
async function main() {
  const file = process.argv[2]; if (!file) throw new Error('Reviewed manifest file required');
  const raw = fs.readFileSync(file, 'utf8'), digest = createHash('sha256').update(raw).digest('hex');
  const manifest = JSON.parse(raw);
  if (!manifest.reviewReference || !Array.isArray(manifest.accounts) || !manifest.accounts.length)
    throw new Error('Impact review reference and explicit accounts are required');
  const apply = process.argv.includes('--apply');
  if (apply && process.env.ALLOWANCE_APPROVED_MANIFEST_SHA256 !== digest)
    throw new Error('Apply requires the exact reviewed manifest SHA256 in ALLOWANCE_APPROVED_MANIFEST_SHA256');
  const db = new PrismaClient();
  try {
    for (const account of manifest.accounts) {
      const { userId, proof, expectedLegacyUsage } = account;
      if (!userId || !proof || !proof.membershipId || !proof.companyId || !proof.planId || !proof.subjectId ||
          ![28,29,30,31].includes(proof.billingDays) || !Number.isSafeInteger(expectedLegacyUsage) || expectedLegacyUsage < 0 ||
          !['CORE','ENTERPRISE'].includes(proof.tier)) throw new Error('Invalid reviewed account evidence');
      await db.$transaction(async tx => {
        const users = await tx.$queryRaw`SELECT "whopId", "tier", "leadsProcessed" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
        const u = users[0];
        if (!u || u.whopId !== proof.subjectId || u.tier !== proof.tier)
          throw new Error('Account changed since review; regenerate impact report');
        const existing = await tx.prospectAllowanceCursor.findUnique({ where: { userId } });
        if (existing) {
          if (existing.approvedMembershipId !== proof.membershipId || existing.approvedCompanyId !== proof.companyId ||
              existing.approvedPlanId !== proof.planId || existing.approvedBillingDays !== proof.billingDays || existing.reviewReference !== manifest.reviewReference)
            throw new Error('Conflicting existing enrollment; never overwrite ledger history');
          return;
        }
        if (u.leadsProcessed !== expectedLegacyUsage) throw new Error('Account usage changed since impact review');
        if (apply) await tx.prospectAllowanceCursor.create({ data: { userId, approvedMembershipId: proof.membershipId,
          approvedCompanyId: proof.companyId, approvedPlanId: proof.planId, approvedBillingDays: proof.billingDays,
          approvedLegacyUsage: expectedLegacyUsage, reviewReference: manifest.reviewReference } });
      });
    }
    console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', reviewedAccounts: manifest.accounts.length, manifestSha256: digest }));
  } finally { await db.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
