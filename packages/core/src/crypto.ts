import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

const KEY_VERSION = "v1";

/** AES-256-GCM for secrets we must read back (bot tokens, webhook signing secrets). */
export class SecretBox {
	private readonly key: Buffer;

	constructor(base64Key: string) {
		this.key = Buffer.from(base64Key, "base64");
		if (this.key.length !== 32) {
			throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
		}
	}

	/** Returns "v1:<iv>:<tag>:<ciphertext>" (base64url parts). */
	encrypt(plaintext: string): string {
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", this.key, iv);
		const ciphertext = Buffer.concat([
			cipher.update(plaintext, "utf8"),
			cipher.final(),
		]);
		const tag = cipher.getAuthTag();
		return [KEY_VERSION, iv, tag, ciphertext]
			.map((part) =>
				typeof part === "string" ? part : part.toString("base64url"),
			)
			.join(":");
	}

	decrypt(payload: string): string {
		const [version, iv, tag, ciphertext] = payload.split(":");
		if (version !== KEY_VERSION || !iv || !tag || !ciphertext) {
			throw new Error("Unsupported encrypted payload");
		}
		const decipher = createDecipheriv(
			"aes-256-gcm",
			this.key,
			Buffer.from(iv, "base64url"),
		);
		decipher.setAuthTag(Buffer.from(tag, "base64url"));
		return Buffer.concat([
			decipher.update(Buffer.from(ciphertext, "base64url")),
			decipher.final(),
		]).toString("utf8");
	}
}

export function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(secret: string, input: string): string {
	return createHmac("sha256", secret).update(input).digest("hex");
}

/** Constant-time string comparison; false for different lengths. */
export function safeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Random base58 string of the given length (unbiased). */
export function randomBase58(length: number): string {
	let out = "";
	while (out.length < length) {
		for (const byte of randomBytes(length * 2)) {
			// 58 * 4 = 232; reject bytes >= 232 to avoid modulo bias.
			if (byte < 232) out += BASE58[byte % 58];
			if (out.length === length) break;
		}
	}
	return out;
}
