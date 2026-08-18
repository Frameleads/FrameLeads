-- Associate production triage and governance data with its owning workspace.
-- Existing unowned design-phase records remain nullable and are intentionally
-- excluded from tenant-scoped production queries.
ALTER TABLE "InboundSignal" ADD COLUMN "userId" TEXT;

DROP INDEX IF EXISTS "InboundSignal_status_isHighPriority_idx";
CREATE INDEX "InboundSignal_userId_status_isHighPriority_idx"
ON "InboundSignal"("userId", "status", "isHighPriority");

ALTER TABLE "InboundSignal"
ADD CONSTRAINT "InboundSignal_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
