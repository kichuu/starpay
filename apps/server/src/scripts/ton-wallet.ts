/**
 * Creates the hot wallet StarPay sends payouts from: `pnpm -F server ton-wallet`.
 *
 * Prints a new 24-word phrase and the V4R2 addresses it derives. Put the phrase
 * in TON_PAYOUT_MNEMONIC_TEST (testnet) or TON_PAYOUT_MNEMONIC_LIVE (mainnet),
 * then fund the matching address. Pass an existing phrase to just show its
 * addresses: pnpm -F server ton-wallet "word1 word2 …".
 */
import {
	mnemonicNew,
	mnemonicToPrivateKey,
	mnemonicValidate,
} from "@ton/crypto";
import { WalletContractV4 } from "@ton/ton";

async function main() {
	const supplied = process.argv.slice(2).join(" ").trim();
	let words: string[];

	if (supplied) {
		words = supplied.split(/\s+/);
		if (!(await mnemonicValidate(words)))
			throw new Error("That is not a valid 24-word TON mnemonic");
	} else {
		words = await mnemonicNew();
		console.log("\nNew wallet phrase — write it down, it is the only copy:\n");
		console.log(`  ${words.join(" ")}\n`);
	}

	const keys = await mnemonicToPrivateKey(words);
	const wallet = WalletContractV4.create({
		workchain: 0,
		publicKey: keys.publicKey,
	});
	console.log("V4R2 addresses (fund the one for the network you're using):\n");
	console.log(`  mainnet  ${wallet.address.toString({ bounceable: false })}`);
	console.log(
		`  testnet  ${wallet.address.toString({ bounceable: false, testOnly: true })}\n`,
	);
	console.log(
		"Next: put the phrase in TON_PAYOUT_MNEMONIC_LIVE (or _TEST), redeploy,",
	);
	console.log(
		"then check Platform admin → Overview shows this same address.\n",
	);
	console.log(
		"Keep only a working float here; it is a hot wallet on the server.\n",
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
