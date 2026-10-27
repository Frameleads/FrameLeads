-- Keep historical Enterprise allocation before moving new-buyer quotas to 10k.
-- This cohort must be reviewed immediately before applying in production.
-- Offer published 2026-10-27 09:51:13 UTC. Only accounts already Enterprise
-- with historical 20k quota created before that event qualify.
-- No existing monthlyQuota/tier/subscription values are modified by migration.
ALTER TABLE "User" ADD COLUMN "enterpriseLegacyQuota" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User"
SET "enterpriseLegacyQuota" = true
WHERE "tier" = 'ENTERPRISE'
  AND "monthlyQuota" = 20000
  AND "createdAt" < TIMESTAMPTZ '2026-10-27T09:51:13Z';
