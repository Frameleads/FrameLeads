CREATE TABLE "MarketMessagingProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countries" TEXT[] NOT NULL,
    "formality" TEXT NOT NULL,
    "directness" TEXT NOT NULL,
    "warmth" TEXT NOT NULL,
    "openerStyle" TEXT NOT NULL,
    "ctaStyle" TEXT NOT NULL,
    "lengthStyle" TEXT NOT NULL,
    "salutationStyle" TEXT NOT NULL,
    "languageGuidance" VARCHAR(120),
    "additionalGuidance" VARCHAR(500),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketMessagingProfile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarketMessagingProfile_userId_enabled_idx" ON "MarketMessagingProfile"("userId", "enabled");
ALTER TABLE "MarketMessagingProfile" ADD CONSTRAINT "MarketMessagingProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
