-- CreateEnum
CREATE TYPE "DecisionOutcomeType" AS ENUM ('MEETING_BOOKED', 'OPPORTUNITY_ADVANCED', 'WON', 'LOST', 'NOT_INTERESTED', 'BAD_FIT', 'NO_RESPONSE', 'OTHER');

-- CreateEnum
CREATE TYPE "DecisionOutcomeSource" AS ENUM ('HUMAN_RECORDED');

-- CreateEnum
CREATE TYPE "LearningSuggestionType" AS ENUM ('SLA_REVIEW');

-- CreateEnum
CREATE TYPE "LearningSuggestionStatus" AS ENUM ('OPEN', 'ACCEPTED_FOR_REVIEW', 'REJECTED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "DecisionOutcome" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "outcomeType" "DecisionOutcomeType" NOT NULL,
    "source" "DecisionOutcomeSource" NOT NULL DEFAULT 'HUMAN_RECORDED',
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "suggestionType" "LearningSuggestionType" NOT NULL,
    "status" "LearningSuggestionStatus" NOT NULL DEFAULT 'OPEN',
    "dimension" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidenceSnapshot" JSONB NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "observedCount" INTEGER NOT NULL,
    "observedSuccessCount" INTEGER NOT NULL,
    "comparisonCount" INTEGER NOT NULL,
    "comparisonSuccessCount" INTEGER NOT NULL,
    "observedRate" INTEGER NOT NULL,
    "comparisonRate" INTEGER NOT NULL,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "targetSubsystem" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNote" TEXT,

    CONSTRAINT "LearningSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DecisionOutcome_userId_decisionId_createdAt_idx" ON "DecisionOutcome"("userId", "decisionId", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionOutcome_userId_occurredAt_idx" ON "DecisionOutcome"("userId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionOutcome_userId_decisionId_revision_key" ON "DecisionOutcome"("userId", "decisionId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionOutcome_userId_idempotencyKey_key" ON "DecisionOutcome"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LearningSuggestion_userId_status_createdAt_idx" ON "LearningSuggestion"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LearningSuggestion_userId_suggestionType_dimension_status_idx" ON "LearningSuggestion"("userId", "suggestionType", "dimension", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LearningSuggestion_userId_fingerprint_key" ON "LearningSuggestion"("userId", "fingerprint");

-- AddForeignKey
ALTER TABLE "DecisionOutcome" ADD CONSTRAINT "DecisionOutcome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionOutcome" ADD CONSTRAINT "DecisionOutcome_userId_decisionId_fkey" FOREIGN KEY ("userId", "decisionId") REFERENCES "Decision"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DecisionOutcome" ADD CONSTRAINT "DecisionOutcome_userId_prospectId_fkey" FOREIGN KEY ("userId", "prospectId") REFERENCES "Prospect"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "LearningSuggestion" ADD CONSTRAINT "LearningSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
