-- AlterTable
ALTER TABLE "InboundSignal" ADD COLUMN     "prospectId" TEXT;

-- AlterTable
ALTER TABLE "GeneratedLead" ADD COLUMN     "prospectId" TEXT;

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "normalizedEmail" TEXT,
    "linkedInUrl" TEXT,
    "normalizedLinkedInUrl" TEXT,
    "companyName" TEXT,
    "websiteUrl" TEXT,
    "fallbackIdentityKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prospect_userId_fallbackIdentityKey_idx" ON "Prospect"("userId", "fallbackIdentityKey");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_userId_id_key" ON "Prospect"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_userId_normalizedEmail_key" ON "Prospect"("userId", "normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_userId_normalizedLinkedInUrl_key" ON "Prospect"("userId", "normalizedLinkedInUrl");

-- CreateIndex
CREATE INDEX "InboundSignal_userId_prospectId_idx" ON "InboundSignal"("userId", "prospectId");

-- CreateIndex
CREATE INDEX "GeneratedLead_userId_prospectId_idx" ON "GeneratedLead"("userId", "prospectId");

-- AddForeignKey
ALTER TABLE "InboundSignal" ADD CONSTRAINT "InboundSignal_userId_prospectId_fkey" FOREIGN KEY ("userId", "prospectId") REFERENCES "Prospect"("userId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "GeneratedLead" ADD CONSTRAINT "GeneratedLead_userId_prospectId_fkey" FOREIGN KEY ("userId", "prospectId") REFERENCES "Prospect"("userId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
