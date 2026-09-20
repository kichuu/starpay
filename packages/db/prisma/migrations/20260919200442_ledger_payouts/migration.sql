-- CreateEnum
CREATE TYPE "Settlement" AS ENUM ('direct', 'platform');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('platform_telegram', 'platform_treasury', 'platform_fees', 'merchant_pending', 'merchant_available', 'merchant_payouts');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('requested', 'sending', 'paid', 'failed', 'cancelled');

-- AlterTable
ALTER TABLE "merchant_settings" ADD COLUMN     "feePlanId" TEXT,
ADD COLUMN     "payoutTonAddress" TEXT;

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "botId" TEXT,
ADD COLUMN     "settlement" "Settlement" NOT NULL DEFAULT 'direct';

-- AlterTable
ALTER TABLE "payment" ADD COLUMN     "availableAt" TIMESTAMP(3),
ADD COLUMN     "feePlanId" TEXT,
ADD COLUMN     "feeStars" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "netStars" INTEGER,
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "settlement" "Settlement" NOT NULL DEFAULT 'direct';

-- CreateTable
CREATE TABLE "fee_plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percentBps" INTEGER NOT NULL,
    "fixedStars" INTEGER NOT NULL DEFAULT 0,
    "payoutFeeStars" INTEGER NOT NULL DEFAULT 0,
    "minPayoutStars" INTEGER NOT NULL DEFAULT 1000,
    "holdDays" INTEGER NOT NULL DEFAULT 21,
    "reserveBps" INTEGER NOT NULL DEFAULT 0,
    "reserveDays" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_account" (
    "id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transaction" (
    "id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "type" TEXT NOT NULL,
    "organizationId" TEXT,
    "paymentId" TEXT,
    "payoutId" TEXT,
    "description" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "amountStars" INTEGER NOT NULL,
    "feeStars" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'requested',
    "tonAddress" TEXT NOT NULL,
    "starUsdRate" DOUBLE PRECISION,
    "tonUsdRate" DOUBLE PRECISION,
    "tonAmountNano" BIGINT,
    "walletSeqno" INTEGER,
    "txReference" TEXT,
    "failureReason" TEXT,
    "requestedById" TEXT NOT NULL,
    "processedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_account_mode_type_organizationId_key" ON "ledger_account"("mode", "type", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transaction_idempotencyKey_key" ON "ledger_transaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ledger_transaction_organizationId_mode_createdAt_idx" ON "ledger_transaction"("organizationId", "mode", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ledger_transaction_paymentId_idx" ON "ledger_transaction"("paymentId");

-- CreateIndex
CREATE INDEX "ledger_transaction_payoutId_idx" ON "ledger_transaction"("payoutId");

-- CreateIndex
CREATE INDEX "ledger_entry_accountId_createdAt_idx" ON "ledger_entry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entry_transactionId_idx" ON "ledger_entry"("transactionId");

-- CreateIndex
CREATE INDEX "payout_organizationId_mode_createdAt_idx" ON "payout"("organizationId", "mode", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "payout_status_createdAt_idx" ON "payout"("status", "createdAt");

-- CreateIndex
CREATE INDEX "order_botId_idx" ON "order"("botId");

-- CreateIndex
CREATE INDEX "payment_settlement_releasedAt_availableAt_idx" ON "payment"("settlement", "releasedAt", "availableAt");

-- AddForeignKey
ALTER TABLE "merchant_settings" ADD CONSTRAINT "merchant_settings_feePlanId_fkey" FOREIGN KEY ("feePlanId") REFERENCES "fee_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ledger_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written: backfill, defaults and ledger integrity ──

-- Existing orders were all issued by the merchant's own bot.
UPDATE "order" o
SET "botId" = b.id
FROM "bot" b
WHERE b."organizationId" = o."organizationId" AND b.mode = o.mode AND o."botId" IS NULL;

-- Default commercial terms (editable from the admin page).
INSERT INTO "fee_plan" ("id", "name", "percentBps", "fixedStars", "payoutFeeStars", "minPayoutStars", "holdDays", "reserveBps", "reserveDays", "isDefault", "updatedAt")
VALUES ('fee_standard', 'Standard', 500, 0, 0, 1000, 21, 1000, 30, true, CURRENT_TIMESTAMP);

-- At most one default plan.
CREATE UNIQUE INDEX "fee_plan_single_default" ON "fee_plan" ("isDefault") WHERE "isDefault";

-- Every ledger transaction must balance to zero. Deferred, so all lines of a
-- transaction are inserted before the check runs (at commit).
CREATE FUNCTION ledger_check_balanced() RETURNS trigger AS $$
BEGIN
  IF (SELECT COALESCE(SUM(amount), 0) FROM "ledger_entry" WHERE "transactionId" = NEW."transactionId") <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % does not balance', NEW."transactionId";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ledger_entry_balanced"
AFTER INSERT ON "ledger_entry"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- The ledger is append-only: corrections are new transactions, never edits.
CREATE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'the ledger is append-only (% on %)', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entry_append_only" BEFORE UPDATE OR DELETE ON "ledger_entry"
FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

CREATE TRIGGER "ledger_transaction_append_only" BEFORE UPDATE OR DELETE ON "ledger_transaction"
FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_nonzero" CHECK (amount <> 0);
ALTER TABLE "payout" ADD CONSTRAINT "payout_positive" CHECK ("amountStars" > 0 AND "feeStars" >= 0);
ALTER TABLE "fee_plan" ADD CONSTRAINT "fee_plan_sane" CHECK (
  "percentBps" BETWEEN 0 AND 10000 AND "fixedStars" >= 0 AND "payoutFeeStars" >= 0
  AND "minPayoutStars" >= 1 AND "holdDays" >= 0 AND "reserveBps" BETWEEN 0 AND 10000 AND "reserveDays" >= 0
);
