-- CreateEnum
CREATE TYPE "ResponseSLAStatus" AS ENUM ('ACTIVE', 'BREACHED', 'RESOLVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ResponseSLAPolicy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "criticalMinutes" INTEGER NOT NULL DEFAULT 15,
    "highMinutes" INTEGER NOT NULL DEFAULT 60,
    "mediumMinutes" INTEGER NOT NULL DEFAULT 240,
    "lowMinutes" INTEGER NOT NULL DEFAULT 1440,
    "unknownMinutes" INTEGER NOT NULL DEFAULT 240,
    "dueSoonPercent" INTEGER NOT NULL DEFAULT 75,
    "breachEscalationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResponseSLAPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResponseSLAInstance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "status" "ResponseSLAStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "breachedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lastEvaluatedAt" TIMESTAMP(3),
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "escalationReason" TEXT,
    "riskScoreAtStart" INTEGER,
    "riskBandAtStart" "RevenueRiskBand",
    "riskConfidenceAtStart" "RevenueRiskConfidence",
    "policyRevision" INTEGER NOT NULL,
    "assignmentId" TEXT,
    "resolutionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResponseSLAInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResponseSLAPolicy_userId_key" ON "ResponseSLAPolicy"("userId");

-- CreateIndex
CREATE INDEX "ResponseSLAInstance_userId_status_dueAt_idx" ON "ResponseSLAInstance"("userId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "ResponseSLAInstance_userId_prospectId_idx" ON "ResponseSLAInstance"("userId", "prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "ResponseSLAInstance_userId_decisionId_key" ON "ResponseSLAInstance"("userId", "decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionAssignment_userId_id_key" ON "DecisionAssignment"("userId", "id");

-- AddForeignKey
ALTER TABLE "ResponseSLAPolicy" ADD CONSTRAINT "ResponseSLAPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponseSLAInstance" ADD CONSTRAINT "ResponseSLAInstance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponseSLAInstance" ADD CONSTRAINT "ResponseSLAInstance_userId_decisionId_fkey" FOREIGN KEY ("userId", "decisionId") REFERENCES "Decision"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ResponseSLAInstance" ADD CONSTRAINT "ResponseSLAInstance_userId_assignmentId_fkey" FOREIGN KEY ("userId", "assignmentId") REFERENCES "DecisionAssignment"("userId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
