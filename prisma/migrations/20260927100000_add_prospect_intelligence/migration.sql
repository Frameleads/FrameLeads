-- CreateEnum
CREATE TYPE "ProspectFitTier" AS ENUM ('STRONG', 'MODERATE', 'WEAK', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "ProspectValueBand" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'STRATEGIC');

-- CreateEnum
CREATE TYPE "ProspectResearchStatus" AS ENUM ('NOT_RESEARCHED', 'RESEARCHING', 'READY', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "ProspectEvidenceType" AS ENUM ('WEBSITE', 'CAREERS', 'SOCIAL', 'NEWS', 'USER_PROVIDED', 'INTERNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ProspectIntelligenceEditor" AS ENUM ('SYSTEM', 'USER');

-- CreateTable
CREATE TABLE "ProspectIntelligence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "fitScore" INTEGER,
    "fitTier" "ProspectFitTier",
    "potentialValueBand" "ProspectValueBand",
    "estimatedValueAmount" DECIMAL(18,2),
    "estimatedValueCurrency" VARCHAR(3),
    "whyFit" TEXT,
    "whyNow" TEXT,
    "triggers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "risks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidenceScore" INTEGER,
    "researchStatus" "ProspectResearchStatus" NOT NULL DEFAULT 'NOT_RESEARCHED',
    "lastEditedBy" "ProspectIntelligenceEditor" NOT NULL DEFAULT 'SYSTEM',
    "researchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectIntelligence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectEvidence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prospectIntelligenceId" TEXT NOT NULL,
    "evidenceType" "ProspectEvidenceType" NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "claim" TEXT NOT NULL,
    "confidenceScore" INTEGER,
    "isUserProvided" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProspectIntelligence_prospectId_key" ON "ProspectIntelligence"("prospectId");

-- CreateIndex
CREATE INDEX "ProspectIntelligence_userId_researchStatus_fitTier_idx" ON "ProspectIntelligence"("userId", "researchStatus", "fitTier");

-- CreateIndex
CREATE INDEX "ProspectIntelligence_userId_potentialValueBand_idx" ON "ProspectIntelligence"("userId", "potentialValueBand");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectIntelligence_userId_id_key" ON "ProspectIntelligence"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectIntelligence_userId_prospectId_key" ON "ProspectIntelligence"("userId", "prospectId");

-- CreateIndex
CREATE INDEX "ProspectEvidence_userId_prospectIntelligenceId_idx" ON "ProspectEvidence"("userId", "prospectIntelligenceId");

-- AddForeignKey
ALTER TABLE "ProspectIntelligence" ADD CONSTRAINT "ProspectIntelligence_userId_prospectId_fkey" FOREIGN KEY ("userId", "prospectId") REFERENCES "Prospect"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProspectEvidence" ADD CONSTRAINT "ProspectEvidence_userId_prospectIntelligenceId_fkey" FOREIGN KEY ("userId", "prospectIntelligenceId") REFERENCES "ProspectIntelligence"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Domain invariants also hold for writes that bypass the application service.
ALTER TABLE "ProspectIntelligence"
  ADD CONSTRAINT "ProspectIntelligence_fitScore_range" CHECK ("fitScore" IS NULL OR "fitScore" BETWEEN 0 AND 100),
  ADD CONSTRAINT "ProspectIntelligence_confidenceScore_range" CHECK ("confidenceScore" IS NULL OR "confidenceScore" BETWEEN 0 AND 100),
  ADD CONSTRAINT "ProspectIntelligence_estimatedValueAmount_nonnegative" CHECK ("estimatedValueAmount" IS NULL OR "estimatedValueAmount" >= 0),
  ADD CONSTRAINT "ProspectIntelligence_currency_format" CHECK ("estimatedValueCurrency" IS NULL OR "estimatedValueCurrency" ~ '^[A-Z]{3}$');

ALTER TABLE "ProspectEvidence"
  ADD CONSTRAINT "ProspectEvidence_confidenceScore_range" CHECK ("confidenceScore" IS NULL OR "confidenceScore" BETWEEN 0 AND 100),
  ADD CONSTRAINT "ProspectEvidence_claim_nonblank" CHECK (btrim("claim") <> ''),
  ADD CONSTRAINT "ProspectEvidence_sourceTitle_nonblank" CHECK (btrim("sourceTitle") <> '');
