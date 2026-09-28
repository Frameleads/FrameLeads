CREATE TYPE "CompanyResearchStatus" AS ENUM ('NOT_RESEARCHED', 'RESEARCHING', 'READY', 'NEEDS_REVIEW', 'FAILED');
ALTER TYPE "AIOperation" ADD VALUE 'SCOUT_COMPANY_ANALYSIS';
ALTER TYPE "AIOperation" ADD VALUE 'SCOUT_PROSPECT_DELTA';

CREATE TABLE "Company" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT,
  "normalizedName" TEXT,
  "websiteUrl" TEXT,
  "normalizedDomain" TEXT,
  "industry" TEXT,
  "companySizeMin" INTEGER,
  "companySizeMax" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Company_userId_id_key" ON "Company"("userId", "id");
CREATE UNIQUE INDEX "Company_userId_normalizedDomain_key" ON "Company"("userId", "normalizedDomain");
CREATE INDEX "Company_userId_normalizedName_idx" ON "Company"("userId", "normalizedName");
ALTER TABLE "Company" ADD CONSTRAINT "Company_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Prospect" ADD COLUMN "companyId" TEXT;
CREATE INDEX "Prospect_userId_companyId_idx" ON "Prospect"("userId", "companyId");
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_userId_companyId_fkey" FOREIGN KEY ("userId", "companyId") REFERENCES "Company"("userId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE "CompanyIntelligence" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "icpProfileId" TEXT,
  "icpFingerprint" TEXT,
  "inputFingerprint" TEXT,
  "status" "CompanyResearchStatus" NOT NULL DEFAULT 'NOT_RESEARCHED',
  "fitScore" INTEGER,
  "fitTier" "ProspectFitTier",
  "valueBand" "ProspectValueBand",
  "whyCompanyFits" TEXT,
  "whyCompanyNow" TEXT,
  "triggers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "risks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "confidenceScore" INTEGER,
  "researchedAt" TIMESTAMP(3),
  "provider" "AIProvider",
  "model" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyIntelligence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompanyIntelligence_companyId_key" ON "CompanyIntelligence"("companyId");
CREATE UNIQUE INDEX "CompanyIntelligence_userId_companyId_key" ON "CompanyIntelligence"("userId", "companyId");
CREATE INDEX "CompanyIntelligence_userId_status_idx" ON "CompanyIntelligence"("userId", "status");
CREATE INDEX "CompanyIntelligence_userId_icpProfileId_idx" ON "CompanyIntelligence"("userId", "icpProfileId");
ALTER TABLE "CompanyIntelligence" ADD CONSTRAINT "CompanyIntelligence_userId_companyId_fkey" FOREIGN KEY ("userId", "companyId") REFERENCES "Company"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "CompanyIntelligence" ADD CONSTRAINT "CompanyIntelligence_userId_icpProfileId_fkey" FOREIGN KEY ("userId", "icpProfileId") REFERENCES "ICPProfile"("userId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE "CompanyEvidence" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "evidenceType" "ProspectEvidenceType" NOT NULL,
  "sourceTitle" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "claim" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyEvidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CompanyEvidence_userId_companyId_idx" ON "CompanyEvidence"("userId", "companyId");
ALTER TABLE "CompanyEvidence" ADD CONSTRAINT "CompanyEvidence_userId_companyId_fkey" FOREIGN KEY ("userId", "companyId") REFERENCES "Company"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
