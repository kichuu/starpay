/*
  Warnings:

  - You are about to drop the column `response` on the `webhook_attempt` table. All the data in the column will be lost.
  - Added the required column `url` to the `webhook_attempt` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "webhook_attempt" DROP COLUMN "response",
ADD COLUMN     "requestBody" TEXT,
ADD COLUMN     "requestHeaders" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "responseBody" TEXT,
ADD COLUMN     "responseHeaders" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "url" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "webhook_endpoint" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "lastFailureAt" TIMESTAMP(3);
