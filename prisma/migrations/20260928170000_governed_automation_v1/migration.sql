-- CreateEnum
CREATE TYPE "AutomationMode" AS ENUM ('AUTOPILOT', 'HUMAN_APPROVAL', 'MANDATORY_ESCALATION');

-- CreateEnum
CREATE TYPE "CampaignAutomationMode" AS ENUM ('INHERIT', 'AUTOPILOT', 'HUMAN_APPROVAL', 'MANDATORY_ESCALATION', 'DISABLE_AUTOMATION');

-- CreateEnum
CREATE TYPE "AutomationExecutionState" AS ENUM ('READY', 'PENDING_APPROVAL', 'ESCALATED', 'HELD', 'BLOCKED', 'REANALYSIS_REQUIRED', 'EXECUTING', 'EXECUTED', 'REJECTED', 'FAILED_UNCERTAIN');

-- CreateEnum
CREATE TYPE "DecisionHumanAction" AS ENUM ('APPROVE', 'EDIT_AND_SEND', 'REJECT', 'ESCALATE', 'AUTOPILOT_SEND');

-- CreateEnum
CREATE TYPE "DecisionAssignmentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DecisionRouteQueue" AS ENUM ('ACCOUNT_OWNER', 'SALES', 'MANAGER', 'SALES_ENGINEERING', 'LEGAL', 'HUMAN_REVIEW');

-- CreateEnum
CREATE TYPE "DecisionExecutionStatus" AS ENUM ('CLAIMED', 'SENT', 'FAILED_UNCERTAIN');

-- CreateTable
CREATE TABLE "AutomationPolicy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultMode" "AutomationMode" NOT NULL DEFAULT 'HUMAN_APPROVAL',
    "fallbackMode" "AutomationMode" NOT NULL DEFAULT 'HUMAN_APPROVAL',
    "autopilotEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoExecutionDisabled" BOOLEAN NOT NULL DEFAULT true,
    "autopilotMinConfidence" INTEGER NOT NULL DEFAULT 90,
    "maxAutoSendsPerDay" INTEGER NOT NULL DEFAULT 20,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationCampaignOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadListId" TEXT NOT NULL,
    "mode" "CampaignAutomationMode" NOT NULL DEFAULT 'INHERIT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationCampaignOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "releasedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionAutomationResolution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "requestedMode" "AutomationMode" NOT NULL,
    "resolvedMode" "AutomationMode" NOT NULL,
    "state" "AutomationExecutionState" NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" INTEGER,
    "policyRevision" INTEGER NOT NULL,
    "decisionConstitutionRevision" INTEGER,
    "currentConstitutionRevision" INTEGER,
    "campaignOverrideId" TEXT,
    "prospectHoldId" TEXT,
    "constitutionRuleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionAutomationResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "status" "DecisionAssignmentStatus" NOT NULL DEFAULT 'OPEN',
    "queue" "DecisionRouteQueue" NOT NULL DEFAULT 'HUMAN_REVIEW',
    "reason" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DecisionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionExecutionAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "DecisionExecutionStatus" NOT NULL DEFAULT 'CLAIMED',
    "mode" "AutomationMode" NOT NULL,
    "actorUserId" TEXT,
    "contentFingerprint" TEXT NOT NULL,
    "sentContent" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "decisionConstitutionRevision" INTEGER,
    "executionConstitutionRevision" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failureClass" TEXT,

    CONSTRAINT "DecisionExecutionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionActionEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "DecisionHumanAction" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT,
    "originalDraft" TEXT,
    "editedDraft" TEXT,
    "resultingState" "AutomationExecutionState" NOT NULL,
    "executionAttemptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionActionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationPolicy_userId_key" ON "AutomationPolicy"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationCampaignOverride_userId_leadListId_key" ON "AutomationCampaignOverride"("userId", "leadListId");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectHold_userId_prospectId_key" ON "ProspectHold"("userId", "prospectId");

-- CreateIndex
CREATE INDEX "DecisionAutomationResolution_userId_decisionId_createdAt_idx" ON "DecisionAutomationResolution"("userId", "decisionId", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionAssignment_userId_status_assignedAt_idx" ON "DecisionAssignment"("userId", "status", "assignedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionAssignment_userId_decisionId_key" ON "DecisionAssignment"("userId", "decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionExecutionAttempt_idempotencyKey_key" ON "DecisionExecutionAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DecisionExecutionAttempt_userId_mode_status_startedAt_idx" ON "DecisionExecutionAttempt"("userId", "mode", "status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionExecutionAttempt_userId_decisionId_key" ON "DecisionExecutionAttempt"("userId", "decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionActionEvent_idempotencyKey_key" ON "DecisionActionEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DecisionActionEvent_userId_decisionId_createdAt_idx" ON "DecisionActionEvent"("userId", "decisionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadList_userId_id_key" ON "LeadList"("userId", "id");

-- AddForeignKey
ALTER TABLE "AutomationPolicy" ADD CONSTRAINT "AutomationPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationCampaignOverride" ADD CONSTRAINT "AutomationCampaignOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationCampaignOverride" ADD CONSTRAINT "AutomationCampaignOverride_userId_leadListId_fkey" FOREIGN KEY ("userId", "leadListId") REFERENCES "LeadList"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProspectHold" ADD CONSTRAINT "ProspectHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectHold" ADD CONSTRAINT "ProspectHold_userId_prospectId_fkey" FOREIGN KEY ("userId", "prospectId") REFERENCES "Prospect"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DecisionAutomationResolution" ADD CONSTRAINT "DecisionAutomationResolution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionAutomationResolution" ADD CONSTRAINT "DecisionAutomationResolution_userId_decisionId_fkey" FOREIGN KEY ("userId", "decisionId") REFERENCES "Decision"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DecisionAssignment" ADD CONSTRAINT "DecisionAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionAssignment" ADD CONSTRAINT "DecisionAssignment_userId_decisionId_fkey" FOREIGN KEY ("userId", "decisionId") REFERENCES "Decision"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DecisionExecutionAttempt" ADD CONSTRAINT "DecisionExecutionAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionExecutionAttempt" ADD CONSTRAINT "DecisionExecutionAttempt_userId_decisionId_fkey" FOREIGN KEY ("userId", "decisionId") REFERENCES "Decision"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DecisionActionEvent" ADD CONSTRAINT "DecisionActionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionActionEvent" ADD CONSTRAINT "DecisionActionEvent_userId_decisionId_fkey" FOREIGN KEY ("userId", "decisionId") REFERENCES "Decision"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
