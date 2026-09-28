CREATE TYPE "RevenueScenario" AS ENUM ('GENERAL','PRICING','DISCOUNT','BUDGET','INTEGRATION','SECURITY','LEGAL','COMPLIANCE','PROCUREMENT','TIMING','NOT_NOW','FEATURE','FEATURE_GAP','IMPLEMENTATION','ONBOARDING','PROOF','CASE_STUDY','COMPETITOR','AUTHORITY','STAKEHOLDER','MEETING','DEMO','TRIAL','PILOT','POSITIVE_INTENT','OBJECTION','SILENCE_FOLLOWUP','NEGATIVE_REPLY','UNSUBSCRIBE','CUSTOM');
CREATE TYPE "RevenuePlaybookSource" AS ENUM ('USER_ENTERED','SYSTEM_DEFAULT');
CREATE TYPE "RevenueDirection" AS ENUM ('INBOUND','OUTBOUND');

CREATE TABLE "RevenuePlaybook" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default Revenue Playbook',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RevenuePlaybook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RevenuePlaybookRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scenario" "RevenueScenario" NOT NULL,
    "customScenario" TEXT,
    "objective" TEXT NOT NULL,
    "guidance" TEXT NOT NULL,
    "nextAction" TEXT NOT NULL,
    "responsePrinciples" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "ctaGuidance" TEXT,
    "qualificationCondition" "ProspectQualificationStatus",
    "direction" "RevenueDirection",
    "priority" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" "RevenuePlaybookSource" NOT NULL DEFAULT 'USER_ENTERED',
    "sourceKey" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RevenuePlaybookRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RevenuePlaybook_userId_key" ON "RevenuePlaybook"("userId");
CREATE UNIQUE INDEX "RevenuePlaybook_userId_id_key" ON "RevenuePlaybook"("userId","id");
CREATE UNIQUE INDEX "RevenuePlaybookRule_userId_source_sourceKey_key" ON "RevenuePlaybookRule"("userId","source","sourceKey");
CREATE INDEX "RevenuePlaybookRule_lookup_idx" ON "RevenuePlaybookRule"("userId","scenario","enabled","archivedAt","priority");
CREATE INDEX "RevenuePlaybookRule_userId_playbookId_archivedAt_idx" ON "RevenuePlaybookRule"("userId","playbookId","archivedAt");

ALTER TABLE "RevenuePlaybook" ADD CONSTRAINT "RevenuePlaybook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RevenuePlaybookRule" ADD CONSTRAINT "RevenuePlaybookRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RevenuePlaybookRule" ADD CONSTRAINT "RevenuePlaybookRule_userId_playbookId_fkey" FOREIGN KEY ("userId","playbookId") REFERENCES "RevenuePlaybook"("userId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
