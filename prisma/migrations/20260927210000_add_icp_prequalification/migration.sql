CREATE TYPE "ProspectQualificationStatus" AS ENUM ('UNASSESSED', 'QUALIFIED', 'REJECTED', 'NEEDS_REVIEW');

CREATE TABLE "ICPProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default ICP',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "targetTitles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetSeniorities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetIndustries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetGeographies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedTitles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedIndustries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companySizeMin" INTEGER,
    "companySizeMax" INTEGER,
    "requiredKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ICPProfile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ICPProfile_companySize_range" CHECK (
      ("companySizeMin" IS NULL OR "companySizeMin" >= 0) AND
      ("companySizeMax" IS NULL OR "companySizeMax" >= 0) AND
      ("companySizeMin" IS NULL OR "companySizeMax" IS NULL OR "companySizeMin" <= "companySizeMax")
);

CREATE TABLE "ProspectQualification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "icpProfileId" TEXT NOT NULL,
    "status" "ProspectQualificationStatus" NOT NULL DEFAULT 'UNASSESSED',
    "matchedCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failedCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "qualificationReason" TEXT NOT NULL,
    "profileUpdatedAt" TIMESTAMP(3) NOT NULL,
    "evaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProspectQualification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ICPProfile_userId_key" ON "ICPProfile"("userId");
CREATE UNIQUE INDEX "ICPProfile_userId_id_key" ON "ICPProfile"("userId", "id");
CREATE UNIQUE INDEX "ProspectQualification_prospectId_key" ON "ProspectQualification"("prospectId");
CREATE UNIQUE INDEX "ProspectQualification_userId_prospectId_key" ON "ProspectQualification"("userId", "prospectId");
CREATE INDEX "ProspectQualification_userId_status_idx" ON "ProspectQualification"("userId", "status");
CREATE INDEX "ProspectQualification_userId_icpProfileId_idx" ON "ProspectQualification"("userId", "icpProfileId");

ALTER TABLE "ICPProfile" ADD CONSTRAINT "ICPProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectQualification" ADD CONSTRAINT "ProspectQualification_userId_prospectId_fkey" FOREIGN KEY ("userId", "prospectId") REFERENCES "Prospect"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ProspectQualification" ADD CONSTRAINT "ProspectQualification_userId_icpProfileId_fkey" FOREIGN KEY ("userId", "icpProfileId") REFERENCES "ICPProfile"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
