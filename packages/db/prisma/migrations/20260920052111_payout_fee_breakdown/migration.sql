-- AlterTable
ALTER TABLE "fee_plan" ADD COLUMN     "payoutFeeBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payoutGasNano" BIGINT NOT NULL DEFAULT 10000000;

-- AlterTable
ALTER TABLE "payout" ADD COLUMN     "feeBreakdown" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "netStars" INTEGER NOT NULL DEFAULT 0;

-- Existing payouts charged the fee on top, so the full amount was sent.
UPDATE "payout" SET "netStars" = "amountStars" WHERE "netStars" = 0;
