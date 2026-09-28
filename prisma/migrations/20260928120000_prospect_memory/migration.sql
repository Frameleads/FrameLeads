CREATE TABLE "ProspectMemoryState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "rollingSummary" TEXT NOT NULL DEFAULT '',
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProspectMemoryState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectMemoryEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProspectMemoryEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProspectMemoryState_userId_prospectId_key" ON "ProspectMemoryState"("userId", "prospectId");
CREATE INDEX "ProspectMemoryState_userId_lastEventAt_idx" ON "ProspectMemoryState"("userId", "lastEventAt");
CREATE UNIQUE INDEX "ProspectMemoryEvent_source_key" ON "ProspectMemoryEvent"("userId", "prospectId", "sourceType", "sourceId", "eventType");
CREATE INDEX "ProspectMemoryEvent_userId_prospectId_occurredAt_idx" ON "ProspectMemoryEvent"("userId", "prospectId", "occurredAt");
CREATE INDEX "ProspectMemoryEvent_userId_prospectId_eventType_occurredAt_idx" ON "ProspectMemoryEvent"("userId", "prospectId", "eventType", "occurredAt");

ALTER TABLE "ProspectMemoryState" ADD CONSTRAINT "ProspectMemoryState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectMemoryState" ADD CONSTRAINT "ProspectMemoryState_userId_prospectId_fkey" FOREIGN KEY ("userId","prospectId") REFERENCES "Prospect"("userId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ProspectMemoryEvent" ADD CONSTRAINT "ProspectMemoryEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectMemoryEvent" ADD CONSTRAINT "ProspectMemoryEvent_userId_prospectId_fkey" FOREIGN KEY ("userId","prospectId") REFERENCES "Prospect"("userId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
