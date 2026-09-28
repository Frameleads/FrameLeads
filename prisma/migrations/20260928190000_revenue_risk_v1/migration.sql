-- CreateEnum
CREATE TYPE "RevenueRiskBand" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RevenueRiskConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "RevenueRiskStatus" AS ENUM ('APPLICABLE', 'INSUFFICIENT_DATA', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "DecisionRevenueRisk" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "status" "RevenueRiskStatus" NOT NULL,
    "score" INTEGER,
    "band" "RevenueRiskBand",
    "confidence" "RevenueRiskConfidence" NOT NULL,
    "components" JSONB NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceReferences" JSONB NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionRevenueRisk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DecisionRevenueRisk_userId_status_score_idx" ON "DecisionRevenueRisk"("userId", "status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionRevenueRisk_userId_decisionId_key" ON "DecisionRevenueRisk"("userId", "decisionId");

-- AddForeignKey
ALTER TABLE "DecisionRevenueRisk" ADD CONSTRAINT "DecisionRevenueRisk_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRevenueRisk" ADD CONSTRAINT "DecisionRevenueRisk_userId_decisionId_fkey" FOREIGN KEY ("userId", "decisionId") REFERENCES "Decision"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
