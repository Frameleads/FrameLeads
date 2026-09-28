CREATE TYPE "AIFeature" AS ENUM ('SCOUT_RESEARCH', 'OUTBOUND_GENERATION', 'INBOX_TRIAGE', 'REPLY_DRAFT', 'DECISION_INTELLIGENCE');
CREATE TYPE "AIOperation" AS ENUM ('ICP_ANALYSIS', 'DRAFT_GENERATION', 'TRIAGE_ANALYSIS');
CREATE TYPE "AIProvider" AS ENUM ('GEMINI', 'ANTHROPIC');
CREATE TYPE "AIUsageStatus" AS ENUM ('SUCCESS', 'FAILED');

CREATE TABLE "AIUsageEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "prospectId" TEXT,
  "feature" "AIFeature" NOT NULL,
  "operation" "AIOperation" NOT NULL,
  "provider" "AIProvider" NOT NULL,
  "model" TEXT NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "totalTokens" INTEGER,
  "cachedInputTokens" INTEGER,
  "reasoningTokens" INTEGER,
  "requestId" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "companyKey" TEXT,
  "status" "AIUsageStatus" NOT NULL,
  "latencyMs" INTEGER NOT NULL,
  "estimatedCostUsdMicros" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AIUsageEvent_userId_createdAt_idx" ON "AIUsageEvent"("userId", "createdAt");
CREATE INDEX "AIUsageEvent_userId_feature_createdAt_idx" ON "AIUsageEvent"("userId", "feature", "createdAt");
CREATE INDEX "AIUsageEvent_userId_model_createdAt_idx" ON "AIUsageEvent"("userId", "model", "createdAt");
CREATE INDEX "AIUsageEvent_userId_requestId_idx" ON "AIUsageEvent"("userId", "requestId");
CREATE INDEX "AIUsageEvent_userId_prospectId_idx" ON "AIUsageEvent"("userId", "prospectId");
ALTER TABLE "AIUsageEvent" ADD CONSTRAINT "AIUsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AIUsageEvent" ADD CONSTRAINT "AIUsageEvent_userId_prospectId_fkey" FOREIGN KEY ("userId", "prospectId") REFERENCES "Prospect"("userId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
