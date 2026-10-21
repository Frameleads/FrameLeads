CREATE TABLE "WhopWebhookReceipt" (
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhopWebhookReceipt_pkey" PRIMARY KEY ("webhookId")
);
