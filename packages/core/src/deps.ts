import type { Database, Mode } from "@starpay/db";
import { TelegramClient } from "@starpay/telegram";

import { SecretBox } from "./crypto";

export type CoreConfig = {
	/** Base URL Telegram posts bot updates to. */
	publicApiUrl: string;
	encryptionKey: string;
};

export type Deps = {
	db: Database;
	box: SecretBox;
	config: CoreConfig;
	now: () => Date;
	/** Builds a Bot API client for a decrypted token; swapped for a fake in tests. */
	telegram: (token: string, mode: Mode) => TelegramClient;
};

/** Which merchant and mode a call acts on. Every query is filtered by both. */
export type Scope = { organizationId: string; mode: Mode };

export type Actor =
	| { type: "user"; id: string }
	| { type: "api_key"; id: string }
	| { type: "system"; id: "system" };

export function createDeps(db: Database, config: CoreConfig): Deps {
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
	};
}
