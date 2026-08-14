-- CreateTable
CREATE TABLE "InboundSignal" (
    "id" TEXT NOT NULL,
    "prospectName" TEXT NOT NULL,
    "prospectContext" TEXT NOT NULL,
    "prospectEmail" TEXT,
    "pipelineValue" INTEGER NOT NULL,
    "dealStage" TEXT NOT NULL,
    "rawEmail" TEXT NOT NULL,
    "intentRisk" TEXT NOT NULL,
    "intentType" TEXT NOT NULL,
    "aiDraft" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isHighPriority" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "signalType" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "InboundSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernanceRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL DEFAULT 'objection_override',
    "trigger" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovernanceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Default',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "whopId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'CORE',
    "monthlyQuota" INTEGER NOT NULL DEFAULT 500,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rootBrandDomain" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendingInbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SendingInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundLog" (
    "id" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "status" TEXT NOT NULL DEFAULT 'sent',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboundSignal_status_isHighPriority_idx" ON "InboundSignal"("status", "isHighPriority");

-- CreateIndex
CREATE INDEX "InboundSignal_createdAt_idx" ON "InboundSignal"("createdAt");

-- CreateIndex
CREATE INDEX "GovernanceRule_userId_isActive_idx" ON "GovernanceRule"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_whopId_key" ON "User"("whopId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "SendingInbox_userId_idx" ON "SendingInbox"("userId");

-- CreateIndex
CREATE INDEX "SendingInbox_emailAddress_idx" ON "SendingInbox"("emailAddress");

-- CreateIndex
CREATE INDEX "OutboundLog_inboxId_sentAt_idx" ON "OutboundLog"("inboxId", "sentAt");

-- AddForeignKey
ALTER TABLE "SendingInbox" ADD CONSTRAINT "SendingInbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundLog" ADD CONSTRAINT "OutboundLog_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "SendingInbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
