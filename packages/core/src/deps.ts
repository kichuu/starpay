import type { Database, Mode } from "@starpay/db";
import { TelegramClient } from "@starpay/telegram";

import { SecretBox } from "./crypto";
import {
	createTonApiRates,
	createTonWallet,
	type RateSource,
	type TonWallet,
} from "./ton";

export type CoreConfig = {
	/** Base URL Telegram posts bot updates to. */
	publicApiUrl: string;
	encryptionKey: string;
	/** Users who can open the platform admin. */
	platformAdminUserIds?: string[];
	/** USD Telegram pays per Star (developer reward rate). */
	starUsdRate?: number;
	/** Hot-wallet mnemonics for automatic TON payouts. Unset = payouts are processed manually. */
	tonMnemonicLive?: string;
	tonMnemonicTest?: string;
	toncenterApiKey?: string;
};

export type Deps = {
	db: Database;
	box: SecretBox;
	config: CoreConfig;
	now: () => Date;
	/** Builds a Bot API client for a decrypted token; swapped for a fake in tests. */
	telegram: (token: string, mode: Mode) => TelegramClient;
	/** Payout wallet for a mode (live → mainnet, test → testnet), or null for manual payouts. */
	tonWallet: (mode: Mode) => Promise<TonWallet | null>;
	rates: RateSource;
};

/** Which merchant and mode a call acts on. Every query is filtered by both. */
export type Scope = { organizationId: string; mode: Mode };

export type Actor =
	| { type: "user"; id: string }
	| { type: "api_key"; id: string }
	| { type: "system"; id: "system" };

export const DEFAULT_STAR_USD_RATE = 0.013;

export function createDeps(db: Database, config: CoreConfig): Deps {
	const wallets = new Map<Mode, Promise<TonWallet | null>>();
	return {
		db,
		box: new SecretBox(config.encryptionKey),
		config,
		now: () => new Date(),
		telegram: (token, mode) =>
			new TelegramClient({
				token,
				environment: mode === "test" ? "test" : "production",
			}),
		tonWallet: (mode) => {
			let wallet = wallets.get(mode);
			if (!wallet) {
				// Empty means "not configured": payouts for this mode are processed by hand.
				const mnemonic = (
					mode === "live" ? config.tonMnemonicLive : config.tonMnemonicTest
				)?.trim();
				wallet = mnemonic
					? createTonWallet({
							mnemonic,
							network: mode === "live" ? "mainnet" : "testnet",
							apiKey: config.toncenterApiKey,
						})
					: Promise.resolve(null);
				wallets.set(mode, wallet);
			}
			return wallet;
		},
		rates: createTonApiRates(),
	};
}
