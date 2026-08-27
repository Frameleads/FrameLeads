ALTER TABLE "InboundSignal"
ALTER COLUMN "pipelineValue" SET DEFAULT 5000;

UPDATE "InboundSignal"
SET "pipelineValue" = 5000
WHERE "pipelineValue" = 0;
