// TON payouts: a hot wallet that sends merchant payouts, and a TON/USD price source.

import { mnemonicToPrivateKey } from "@ton/crypto";
import {
	Address,
	internal,
	SendMode,
	TonClient,
	WalletContractV4,
} from "@ton/ton";

export type TonNetwork = "mainnet" | "testnet";

/** Minimal wallet surface the payout processor needs; swapped for a fake in tests. */
export interface TonWallet {
	readonly network: TonNetwork;
	readonly address: string;
	getSeqno(): Promise<number>;
	/**
	 * Sends a transfer with an explicit seqno. The wallet contract accepts each
	 * seqno once, so re-sending the same seqno after a crash can't pay twice.
	 */
	transfer(input: {
		seqno: number;
		to: string;
		amountNano: bigint;
		comment: string;
	}): Promise<void>;
}

export interface RateSource {
	/** USD per TON. */
	tonUsd(): Promise<number>;
}

export function isValidTonAddress(value: string): boolean {
	try {
		Address.parse(value.trim());
		return true;
	} catch {
		return false;
	}
}

/** A dedicated V4R2 wallet. Don't use it for anything but payouts: seqno tracking assumes sole use. */
export async function createTonWallet(input: {
	mnemonic: string;
	network: TonNetwork;
	apiKey?: string;
}): Promise<TonWallet> {
	const keys = await mnemonicToPrivateKey(input.mnemonic.trim().split(/\s+/));
	const wallet = WalletContractV4.create({
		workchain: 0,
		publicKey: keys.publicKey,
	});
	const client = new TonClient({
		endpoint:
			input.network === "testnet"
				? "https://testnet.toncenter.com/api/v2/jsonRPC"
				: "https://toncenter.com/api/v2/jsonRPC",
		apiKey: input.apiKey,
	});
	const contract = client.open(wallet);
	const address = wallet.address.toString({
		testOnly: input.network === "testnet",
		bounceable: false,
	});

	return {
		network: input.network,
		address,
		getSeqno: () => contract.getSeqno(),
		async transfer({ seqno, to, amountNano, comment }) {
			await contract.sendTransfer({
				seqno,
				secretKey: keys.secretKey,
				sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
				// Valid for 60 seconds; after that the same seqno can safely be retried.
				timeout: Math.floor(Date.now() / 1000) + 60,
				messages: [
					internal({
						to: Address.parse(to),
						value: amountNano,
						body: comment,
						// Payout addresses are usually uninitialised user wallets.
						bounce: false,
					}),
				],
			});
		},
	};
}

/** TON/USD from tonapi.io, cached for five minutes. */
export function createTonApiRates(fetchImpl: typeof fetch = fetch): RateSource {
	let cached: { value: number; at: number } | null = null;
	return {
		async tonUsd() {
			if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;
			const response = await fetchImpl(
				"https://tonapi.io/v2/rates?tokens=ton&currencies=usd",
				{
					signal: AbortSignal.timeout(10_000),
				},
			);
			const body = (await response.json()) as {
				rates?: { TON?: { prices?: { USD?: number } } };
			};
			const value = body.rates?.TON?.prices?.USD;
			if (!value || !Number.isFinite(value) || value <= 0)
				throw new Error("TON price unavailable");
			cached = { value, at: Date.now() };
			return value;
		},
	};
}

/**
 * Nano-TON for a Stars amount at the given USD rates, rounded to the nearest
 * nano-TON (rounding down let float error shave a nano off exact amounts).
 */
export function starsToNanoTon(
	stars: number,
	starUsd: number,
	tonUsd: number,
): bigint {
	return BigInt(Math.round((stars * starUsd * 1e9) / tonUsd));
}
