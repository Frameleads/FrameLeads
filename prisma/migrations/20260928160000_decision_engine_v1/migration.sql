CREATE TYPE "ConversationStatus" AS ENUM ('OPEN','CLOSED');
CREATE TYPE "ConversationDirection" AS ENUM ('INBOUND','OUTBOUND');
CREATE TYPE "ConversationSourceType" AS ENUM ('INBOUND_SIGNAL','OUTBOUND_LOG');
CREATE TYPE "DecisionType" AS ENUM ('INBOUND_TRIAGE');
CREATE TYPE "DecisionStatus" AS ENUM ('PENDING','READY','NEEDS_REVIEW','FAILED');
CREATE TYPE "DecisionSource" AS ENUM ('DETERMINISTIC','GEMINI','UNAVAILABLE');
CREATE TYPE "TriageIntent" AS ENUM ('POSITIVE_INTEREST','MEETING_REQUEST','PRICING_INQUIRY','PRICING_OBJECTION','TIMING_OBJECTION','COMPETITOR_OBJECTION','TRUST_OBJECTION','BUDGET_OBJECTION','FEATURE_QUESTION','FEATURE_GAP','INTEGRATION_QUESTION','SECURITY','PROCUREMENT','LEGAL','COMPLIANCE','REFERRAL','WRONG_PERSON','NOT_INTERESTED','UNSUBSCRIBE','OUT_OF_OFFICE','NEUTRAL_QUESTION','CONFUSED','NEGOTIATION','EXISTING_CUSTOMER','SPAM','OTHER');

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "direction" "ConversationDirection" NOT NULL,
    "sourceType" "ConversationSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "providerId" TEXT,
    "body" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "inputMessageId" TEXT NOT NULL,
    "decisionType" "DecisionType" NOT NULL DEFAULT 'INBOUND_TRIAGE',
    "status" "DecisionStatus" NOT NULL DEFAULT 'PENDING',
    "source" "DecisionSource" NOT NULL DEFAULT 'UNAVAILABLE',
    "contextFingerprint" TEXT NOT NULL,
    "primaryIntent" "TriageIntent",
    "secondaryIntents" "TriageIntent"[] NOT NULL DEFAULT ARRAY[]::"TriageIntent"[],
    "intentSignals" JSONB,
    "confidenceScore" INTEGER,
    "interpretation" TEXT,
    "recommendedNextAction" TEXT,
    "suggestedReply" TEXT,
    "requiresReview" BOOLEAN NOT NULL DEFAULT true,
    "reviewReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "explanation" TEXT,
    "provider" "AIProvider",
    "model" TEXT,
    "shadowMode" BOOLEAN NOT NULL DEFAULT true,
    "supersedesDecisionId" TEXT,
    "automationMode" TEXT,
    "assignedOwnerId" TEXT,
    "revenueAtRiskScore" INTEGER,
    "slaDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecisionTrace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "inputMessageId" TEXT NOT NULL,
    "contextFingerprint" TEXT NOT NULL,
    "memoryState" JSONB,
    "icpState" JSONB,
    "brainRevision" INTEGER,
    "playbookRevision" INTEGER,
    "constitutionRevision" INTEGER,
    "intentOutput" JSONB,
    "policyResult" JSONB,
    "playbookRuleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "brainEntryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "contextReferences" JSONB,
    "engineVersion" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DecisionTrace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Conversation_userId_id_key" ON "Conversation"("userId","id");
CREATE UNIQUE INDEX "Conversation_userId_prospectId_key" ON "Conversation"("userId","prospectId");
CREATE INDEX "Conversation_userId_lastMessageAt_idx" ON "Conversation"("userId","lastMessageAt");
CREATE UNIQUE INDEX "ConversationMessage_userId_id_key" ON "ConversationMessage"("userId","id");
CREATE UNIQUE INDEX "ConversationMessage_source_key" ON "ConversationMessage"("userId","sourceType","sourceId");
CREATE INDEX "ConversationMessage_userId_conversationId_occurredAt_idx" ON "ConversationMessage"("userId","conversationId","occurredAt");
CREATE UNIQUE INDEX "Decision_userId_id_key" ON "Decision"("userId","id");
CREATE UNIQUE INDEX "Decision_context_key" ON "Decision"("userId","inputMessageId","decisionType","contextFingerprint");
CREATE INDEX "Decision_userId_prospectId_createdAt_idx" ON "Decision"("userId","prospectId","createdAt");
CREATE INDEX "Decision_userId_inputMessageId_idx" ON "Decision"("userId","inputMessageId");
CREATE INDEX "Decision_userId_status_createdAt_idx" ON "Decision"("userId","status","createdAt");
CREATE UNIQUE INDEX "DecisionTrace_decisionId_key" ON "DecisionTrace"("decisionId");
CREATE UNIQUE INDEX "DecisionTrace_userId_decisionId_key" ON "DecisionTrace"("userId","decisionId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_prospectId_fkey" FOREIGN KEY ("userId","prospectId") REFERENCES "Prospect"("userId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_userId_conversationId_fkey" FOREIGN KEY ("userId","conversationId") REFERENCES "Conversation"("userId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_userId_prospectId_fkey" FOREIGN KEY ("userId","prospectId") REFERENCES "Prospect"("userId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_userId_prospectId_fkey" FOREIGN KEY ("userId","prospectId") REFERENCES "Prospect"("userId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_userId_conversationId_fkey" FOREIGN KEY ("userId","conversationId") REFERENCES "Conversation"("userId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_userId_inputMessageId_fkey" FOREIGN KEY ("userId","inputMessageId") REFERENCES "ConversationMessage"("userId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "DecisionTrace" ADD CONSTRAINT "DecisionTrace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionTrace" ADD CONSTRAINT "DecisionTrace_userId_decisionId_fkey" FOREIGN KEY ("userId","decisionId") REFERENCES "Decision"("userId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
