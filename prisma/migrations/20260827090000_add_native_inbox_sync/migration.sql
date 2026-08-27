ALTER TABLE "InboundSignal"
ADD COLUMN "generatedLeadId" TEXT,
ADD COLUMN "sourceMessageId" TEXT;

CREATE INDEX "InboundSignal_generatedLeadId_idx"
ON "InboundSignal"("generatedLeadId");

CREATE UNIQUE INDEX "InboundSignal_userId_sourceMessageId_key"
ON "InboundSignal"("userId", "sourceMessageId");

ALTER TABLE "InboundSignal"
ADD CONSTRAINT "InboundSignal_generatedLeadId_fkey"
FOREIGN KEY ("generatedLeadId") REFERENCES "GeneratedLead"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
