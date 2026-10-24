ALTER TABLE "User"
ADD COLUMN "microPilotDecisionsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "microPilotOutboundUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "microPilotResearchUsed" INTEGER NOT NULL DEFAULT 0;

-- Preserve any analyses a tenant already completed before this allowance shipped.
UPDATE "User" u
SET "microPilotDecisionsUsed" = LEAST(3, (
  SELECT COUNT(DISTINCT d."prospectId")
  FROM "Decision" d
  WHERE d."userId" = u."id"
))
WHERE u."tier" = 'MICRO_PILOT';

UPDATE "User" SET "microPilotOutboundUsed" = LEAST(25, "leadsProcessed") WHERE "tier" = 'MICRO_PILOT';

CREATE TABLE "MicroPilotResearchClaim" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MicroPilotResearchClaim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MicroPilotResearchClaim_userId_prospectId_key"
ON "MicroPilotResearchClaim"("userId", "prospectId");
CREATE INDEX "MicroPilotResearchClaim_userId_createdAt_idx"
ON "MicroPilotResearchClaim"("userId", "createdAt");
ALTER TABLE "MicroPilotResearchClaim"
ADD CONSTRAINT "MicroPilotResearchClaim_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MicroPilotResearchClaim"
ADD CONSTRAINT "MicroPilotResearchClaim_userId_prospectId_fkey"
FOREIGN KEY ("userId", "prospectId") REFERENCES "Prospect"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

INSERT INTO "MicroPilotResearchClaim" ("id", "userId", "prospectId", "createdAt")
SELECT md5(u."id" || ':' || p."id"), u."id", p."id", pi."updatedAt"
FROM "User" u
JOIN "ProspectIntelligence" pi ON pi."userId" = u."id"
JOIN "Prospect" p ON p."userId" = u."id" AND p."id" = pi."prospectId"
WHERE u."tier" = 'MICRO_PILOT' AND pi."researchStatus" <> 'NOT_RESEARCHED';

UPDATE "User" u SET "microPilotResearchUsed" = LEAST(3, (
  SELECT COUNT(*) FROM "MicroPilotResearchClaim" c WHERE c."userId" = u."id"
)) WHERE u."tier" = 'MICRO_PILOT';

CREATE TABLE "MicroPilotDecisionClaim" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MicroPilotDecisionClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MicroPilotDecisionClaim_userId_prospectId_key"
ON "MicroPilotDecisionClaim"("userId", "prospectId");
CREATE INDEX "MicroPilotDecisionClaim_userId_createdAt_idx"
ON "MicroPilotDecisionClaim"("userId", "createdAt");

ALTER TABLE "MicroPilotDecisionClaim"
ADD CONSTRAINT "MicroPilotDecisionClaim_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MicroPilotDecisionClaim"
ADD CONSTRAINT "MicroPilotDecisionClaim_userId_prospectId_fkey"
FOREIGN KEY ("userId", "prospectId") REFERENCES "Prospect"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
