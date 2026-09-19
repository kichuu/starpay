-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('live', 'test');

-- CreateEnum
CREATE TYPE "BotStatus" AS ENUM ('active', 'invalid_token', 'webhook_error', 'disconnected');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('one_time', 'subscription');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('created', 'pre_checkout', 'paid', 'refunded', 'expired', 'failed');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "EndpointStatus" AS ENUM ('active', 'disabled');

-- AlterTable
ALTER TABLE "session" ADD COLUMN     "activeOrganizationId" TEXT;

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "metadata" TEXT,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviterId" TEXT NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_settings" (
    "organizationId" TEXT NOT NULL,
    "paySupportText" TEXT NOT NULL DEFAULT '',
    "notifyPayment" BOOLEAN NOT NULL DEFAULT true,
    "notifyWebhookFail" BOOLEAN NOT NULL DEFAULT true,
    "notifySubCancel" BOOLEAN NOT NULL DEFAULT true,
    "notifyDigest" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_settings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "bot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "telegramBotId" BIGINT NOT NULL,
    "username" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "tokenLast4" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "status" "BotStatus" NOT NULL DEFAULT 'active',
    "lastUpdateAt" TIMESTAMP(3),
    "lastUpdateType" TEXT,
    "pendingUpdates" INTEGER NOT NULL DEFAULT 0,
    "lastWebhookError" TEXT,
    "starBalance" INTEGER,
    "balanceSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "lookupKey" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "photoUrl" TEXT,
    "priceStars" INTEGER NOT NULL,
    "type" "ProductType" NOT NULL,
    "periodSeconds" INTEGER,
    "status" "ProductStatus" NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "languageCode" TEXT,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "lastPaymentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "productId" TEXT NOT NULL,
    "customerId" TEXT,
    "payerTelegramId" BIGINT,
    "amountStars" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'created',
    "failureReason" TEXT,
    "merchantReference" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "invoiceLink" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "apiKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "orderId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "telegramChargeId" TEXT NOT NULL,
    "amountStars" INTEGER NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "isFirstRecurring" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionExpiresAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "productId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "firstChargeId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_event" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_update" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "updateId" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingMs" INTEGER,
    "error" TEXT,

    CONSTRAINT "telegram_update_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "events" TEXT[],
    "status" "EndpointStatus" NOT NULL DEFAULT 'active',
    "secretEncrypted" TEXT NOT NULL,
    "prevSecretEncrypted" TEXT,
    "prevSecretExpiresAt" TIMESTAMP(3),
    "secretRotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "type" TEXT NOT NULL,
    "orderId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "lastLatencyMs" INTEGER,
    "lastError" TEXT,
    "lastResponse" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_attempt" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "statusCode" INTEGER,
    "latencyMs" INTEGER,
    "error" TEXT,
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "star_transaction" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "telegramTxId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "orderId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "raw" JSONB NOT NULL,

    CONSTRAINT "star_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "Mode",
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "member_organizationId_idx" ON "member"("organizationId");

-- CreateIndex
CREATE INDEX "member_userId_idx" ON "member"("userId");

-- CreateIndex
CREATE INDEX "invitation_organizationId_idx" ON "invitation"("organizationId");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "bot_organizationId_mode_key" ON "bot"("organizationId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "bot_telegramBotId_mode_key" ON "bot"("telegramBotId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_hash_key" ON "api_key"("hash");

-- CreateIndex
CREATE INDEX "api_key_organizationId_mode_idx" ON "api_key"("organizationId", "mode");

-- CreateIndex
CREATE INDEX "product_organizationId_mode_status_idx" ON "product"("organizationId", "mode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_organizationId_mode_lookupKey_key" ON "product"("organizationId", "mode", "lookupKey");

-- CreateIndex
CREATE INDEX "customer_organizationId_mode_totalSpent_idx" ON "customer"("organizationId", "mode", "totalSpent" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "customer_organizationId_mode_telegramUserId_key" ON "customer"("organizationId", "mode", "telegramUserId");

-- CreateIndex
CREATE INDEX "order_organizationId_mode_createdAt_idx" ON "order"("organizationId", "mode", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "order_organizationId_mode_status_idx" ON "order"("organizationId", "mode", "status");

-- CreateIndex
CREATE INDEX "order_status_expiresAt_idx" ON "order"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "order_organizationId_mode_merchantReference_idx" ON "order"("organizationId", "mode", "merchantReference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_telegramChargeId_key" ON "payment"("telegramChargeId");

-- CreateIndex
CREATE INDEX "payment_orderId_idx" ON "payment"("orderId");

-- CreateIndex
CREATE INDEX "payment_organizationId_mode_createdAt_idx" ON "payment"("organizationId", "mode", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_orderId_key" ON "subscription"("orderId");

-- CreateIndex
CREATE INDEX "subscription_organizationId_mode_status_idx" ON "subscription"("organizationId", "mode", "status");

-- CreateIndex
CREATE INDEX "subscription_status_currentPeriodEnd_idx" ON "subscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "order_event_orderId_createdAt_idx" ON "order_event"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "telegram_update_botId_receivedAt_idx" ON "telegram_update"("botId", "receivedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_update_botId_updateId_key" ON "telegram_update"("botId", "updateId");

-- CreateIndex
CREATE INDEX "webhook_endpoint_organizationId_mode_idx" ON "webhook_endpoint"("organizationId", "mode");

-- CreateIndex
CREATE INDEX "webhook_event_organizationId_mode_createdAt_idx" ON "webhook_event"("organizationId", "mode", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "webhook_event_orderId_idx" ON "webhook_event"("orderId");

-- CreateIndex
CREATE INDEX "webhook_delivery_status_nextAttemptAt_idx" ON "webhook_delivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "webhook_delivery_endpointId_createdAt_idx" ON "webhook_delivery"("endpointId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "webhook_delivery_eventId_idx" ON "webhook_delivery"("eventId");

-- CreateIndex
CREATE INDEX "webhook_attempt_deliveryId_idx" ON "webhook_attempt"("deliveryId");

-- CreateIndex
CREATE INDEX "star_transaction_botId_date_idx" ON "star_transaction"("botId", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "star_transaction_botId_telegramTxId_key" ON "star_transaction"("botId", "telegramTxId");

-- CreateIndex
CREATE INDEX "idempotency_record_createdAt_idx" ON "idempotency_record"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_organizationId_mode_key_key" ON "idempotency_record"("organizationId", "mode", "key");

-- CreateIndex
CREATE INDEX "audit_log_organizationId_createdAt_idx" ON "audit_log"("organizationId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_update" ADD CONSTRAINT "telegram_update_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "webhook_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_attempt" ADD CONSTRAINT "webhook_attempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "webhook_delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "star_transaction" ADD CONSTRAINT "star_transaction_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
