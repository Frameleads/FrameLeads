CREATE TABLE "MicroPilotNativeSendClaim" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESERVED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "MicroPilotNativeSendClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MicroPilotNativeSendClaim_userId_prospectId_key"
ON "MicroPilotNativeSendClaim"("userId", "prospectId");
CREATE UNIQUE INDEX "MicroPilotNativeSendClaim_userId_identityKey_key"
ON "MicroPilotNativeSendClaim"("userId", "identityKey");
CREATE INDEX "MicroPilotNativeSendClaim_userId_status_createdAt_idx"
ON "MicroPilotNativeSendClaim"("userId", "status", "createdAt");

ALTER TABLE "MicroPilotNativeSendClaim"
ADD CONSTRAINT "MicroPilotNativeSendClaim_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
