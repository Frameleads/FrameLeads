CREATE TYPE "ConstitutionCategory" AS ENUM ('CLAIM','PRICING','DISCOUNT','COMMERCIAL_TERM','LEGAL','COMPLIANCE','SECURITY','PRIVACY','DATA_HANDLING','CONTRACT','CAPABILITY','COMPETITOR','OUTREACH','UNSUBSCRIBE','COMMUNICATION','COMMITMENT','APPROVAL','CUSTOM');
CREATE TYPE "ConstitutionEffect" AS ENUM ('BLOCK','REQUIRE_HUMAN','REQUIRE_APPROVAL','REQUIRE_SAFE_RESPONSE');
CREATE TYPE "ConstitutionActionType" AS ENUM ('OUTREACH','DISCOUNT','CONTRACT','CLAIM','TOPIC_RESPONSE','COMMITMENT');
CREATE TYPE "ConstitutionSource" AS ENUM ('USER_ENTERED','SYSTEM_DEFAULT');
CREATE TYPE "ConstitutionSeverity" AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
CREATE TYPE "ConstitutionScope" AS ENUM ('GLOBAL','OUTBOUND','REPLY_DECISION','PRICING','COMMERCIAL','LEGAL','COMPLIANCE','SECURITY');
CREATE TYPE "ConstitutionChangeType" AS ENUM ('CREATE','EDIT','ENABLE','DISABLE','ARCHIVE');

CREATE TABLE "SalesConstitution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Company Sales Constitution',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesConstitution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesConstitutionRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "constitutionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ConstitutionCategory" NOT NULL,
    "effect" "ConstitutionEffect" NOT NULL,
    "severity" "ConstitutionSeverity" NOT NULL DEFAULT 'MEDIUM',
    "scope" "ConstitutionScope" NOT NULL DEFAULT 'GLOBAL',
    "description" TEXT NOT NULL,
    "constraint" JSONB NOT NULL,
    "actionTypes" "ConstitutionActionType"[] NOT NULL DEFAULT ARRAY[]::"ConstitutionActionType"[],
    "priority" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" "ConstitutionSource" NOT NULL DEFAULT 'USER_ENTERED',
    "sourceKey" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesConstitutionRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesConstitutionRevisionEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "constitutionId" TEXT NOT NULL,
    "constitutionRevision" INTEGER NOT NULL,
    "ruleId" TEXT NOT NULL,
    "changeType" "ConstitutionChangeType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesConstitutionRevisionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesConstitution_userId_key" ON "SalesConstitution"("userId");
CREATE UNIQUE INDEX "SalesConstitution_userId_id_key" ON "SalesConstitution"("userId","id");
CREATE UNIQUE INDEX "SalesConstitutionRule_userId_source_sourceKey_key" ON "SalesConstitutionRule"("userId","source","sourceKey");
CREATE INDEX "SalesConstitutionRule_lookup_idx" ON "SalesConstitutionRule"("userId","category","enabled","archivedAt","effect");
CREATE INDEX "SalesConstitutionRule_owner_idx" ON "SalesConstitutionRule"("userId","constitutionId","archivedAt");
CREATE INDEX "SalesConstitutionEvent_history_idx" ON "SalesConstitutionRevisionEvent"("userId","constitutionId","createdAt");

ALTER TABLE "SalesConstitution" ADD CONSTRAINT "SalesConstitution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesConstitutionRule" ADD CONSTRAINT "SalesConstitutionRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesConstitutionRule" ADD CONSTRAINT "SalesConstitutionRule_userId_constitutionId_fkey" FOREIGN KEY ("userId","constitutionId") REFERENCES "SalesConstitution"("userId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SalesConstitutionRevisionEvent" ADD CONSTRAINT "SalesConstitutionRevisionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesConstitutionRevisionEvent" ADD CONSTRAINT "SalesConstitutionRevisionEvent_userId_constitutionId_fkey" FOREIGN KEY ("userId","constitutionId") REFERENCES "SalesConstitution"("userId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
