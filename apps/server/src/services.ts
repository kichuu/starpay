import { createAuth } from "@starpay/auth";
import { createDeps, createServices } from "@starpay/core";
import { createPrismaClient } from "@starpay/db";

import { ENV } from "./env.server";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db);
export const services = createServices(
	createDeps(db, {
		publicApiUrl: ENV.PUBLIC_API_URL,
		encryptionKey: ENV.ENCRYPTION_KEY,
		platformAdminUserIds: ENV.PLATFORM_ADMIN_USER_IDS,
		starUsdRate: ENV.STAR_USD_RATE,
		tonMnemonicLive: ENV.TON_PAYOUT_MNEMONIC_LIVE,
		tonMnemonicTest: ENV.TON_PAYOUT_MNEMONIC_TEST,
		toncenterApiKey: ENV.TONCENTER_API_KEY,
	}),
);
