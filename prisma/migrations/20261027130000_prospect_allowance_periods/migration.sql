BEGIN;

-- CreateTable
CREATE TABLE "ProspectAllowancePeriod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "used" INTEGER NOT NULL,
    "legacySeed" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ProspectAllowancePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectAllowanceCursor" (
    "userId" TEXT NOT NULL,
    "currentPeriodId" TEXT,
    "approvedMembershipId" TEXT NOT NULL,
    "approvedCompanyId" TEXT NOT NULL,
    "approvedPlanId" TEXT NOT NULL,
    "approvedBillingDays" INTEGER NOT NULL,
    "approvedLegacyUsage" INTEGER NOT NULL,
    "reviewReference" TEXT NOT NULL,
    "enrolledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectAllowanceCursor_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ProspectAllowanceOperation" (
    "userId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "periodId" TEXT,
    "allocated" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "response" JSONB,
    "statusCode" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectAllowanceOperation_pkey" PRIMARY KEY ("userId","operationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProspectAllowancePeriod_userId_id_key" ON "ProspectAllowancePeriod"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectAllowancePeriod_userId_periodStart_key" ON "ProspectAllowancePeriod"("userId", "periodStart");

-- CreateIndex
CREATE INDEX "ProspectAllowanceOperation_userId_periodId_idx" ON "ProspectAllowanceOperation"("userId", "periodId");

-- AddForeignKey
ALTER TABLE "ProspectAllowancePeriod" ADD CONSTRAINT "ProspectAllowancePeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProspectAllowanceCursor" ADD CONSTRAINT "ProspectAllowanceCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProspectAllowanceCursor" ADD CONSTRAINT "ProspectAllowanceCursor_userId_currentPeriodId_fkey" FOREIGN KEY ("userId", "currentPeriodId") REFERENCES "ProspectAllowancePeriod"("userId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProspectAllowanceOperation" ADD CONSTRAINT "ProspectAllowanceOperation_userId_periodId_fkey" FOREIGN KEY ("userId", "periodId") REFERENCES "ProspectAllowancePeriod"("userId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- Reject invalid states at the storage boundary, including direct maintenance writes.
ALTER TABLE "ProspectAllowancePeriod" ADD CONSTRAINT "allowance_valid_period" CHECK ("periodStart" < "periodEnd");
ALTER TABLE "ProspectAllowancePeriod" ADD CONSTRAINT "allowance_nonnegative_usage" CHECK ("used" >= 0 AND "legacySeed" >= 0);
ALTER TABLE "ProspectAllowanceCursor" ADD CONSTRAINT "allowance_reviewed_cadence" CHECK ("approvedBillingDays" BETWEEN 28 AND 31 AND "approvedLegacyUsage" >= 0 AND length("reviewReference") > 0);
ALTER TABLE "ProspectAllowanceOperation" ADD CONSTRAINT "allowance_operation_valid" CHECK (("allocated" IS NULL OR "allocated" >= 0) AND "status" IN ('PROCESSING','COMPLETED','FAILED') AND (("status"='PROCESSING' AND "response" IS NULL AND "statusCode" IS NULL) OR ("status"<>'PROCESSING' AND "response" IS NOT NULL AND "statusCode" IS NOT NULL AND "statusCode" BETWEEN 200 AND 599)));

ALTER TABLE "ProspectAllowanceOperation" ADD CONSTRAINT "ProspectAllowanceOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT;
