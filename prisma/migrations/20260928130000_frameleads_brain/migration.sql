CREATE TYPE "BrainKnowledgeCategory" AS ENUM ('COMPANY','PRODUCT','OFFER','ICP','POSITIONING','DIFFERENTIATOR','PAIN_POINT','VALUE_PROPOSITION','PROOF','CASE_STUDY','PRICING','COMMERCIAL_TERM','INTEGRATION','OBJECTION_CONTEXT','TONE','CTA','SALES_PROCESS','FAQ','LIMITATION','MARKET','OTHER');
CREATE TYPE "BrainKnowledgeSource" AS ENUM ('USER_ENTERED','USER_PROFILE','ICP_PROFILE');
CREATE TYPE "BrainVerification" AS ENUM ('VERIFIED','UNVERIFIED','INFERRED','CONFLICTED');

CREATE TABLE "FrameLeadsBrain" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "compactSummary" TEXT NOT NULL DEFAULT '',
    "lastKnowledgeUpdateAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FrameLeadsBrain_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrainKnowledgeEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brainId" TEXT NOT NULL,
    "category" "BrainKnowledgeCategory" NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sourceType" "BrainKnowledgeSource" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceId" TEXT,
    "verification" "BrainVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "importance" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrainKnowledgeEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FrameLeadsBrain_userId_key" ON "FrameLeadsBrain"("userId");
CREATE UNIQUE INDEX "FrameLeadsBrain_userId_id_key" ON "FrameLeadsBrain"("userId","id");
CREATE UNIQUE INDEX "BrainKnowledgeEntry_userId_sourceType_sourceKey_key" ON "BrainKnowledgeEntry"("userId","sourceType","sourceKey");
CREATE INDEX "BrainKnowledgeEntry_userId_category_verification_archivedAt_idx" ON "BrainKnowledgeEntry"("userId","category","verification","archivedAt");
CREATE INDEX "BrainKnowledgeEntry_userId_brainId_archivedAt_idx" ON "BrainKnowledgeEntry"("userId","brainId","archivedAt");

ALTER TABLE "FrameLeadsBrain" ADD CONSTRAINT "FrameLeadsBrain_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrainKnowledgeEntry" ADD CONSTRAINT "BrainKnowledgeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrainKnowledgeEntry" ADD CONSTRAINT "BrainKnowledgeEntry_userId_brainId_fkey" FOREIGN KEY ("userId","brainId") REFERENCES "FrameLeadsBrain"("userId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
