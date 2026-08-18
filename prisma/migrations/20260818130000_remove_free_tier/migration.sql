-- FrameLeads has no free entitlement. Preserve historical records as inactive
-- while preventing future records from defaulting to an access-bearing tier.
ALTER TABLE "User" ALTER COLUMN "tier" SET DEFAULT 'INACTIVE';

UPDATE "User"
SET "tier" = 'INACTIVE', "monthlyQuota" = 0
WHERE "tier" = 'FREE';
