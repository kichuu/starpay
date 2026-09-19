import type { Mode } from "@starpay/db";

import { randomBase58, sha256Hex } from "../crypto";
import type { Actor, Deps, Scope } from "../deps";
import { errors } from "../errors";
import { newId } from "../ids";
import { serializeApiKey } from "../serializers";
import { audit } from "./audit";

const KEY_PATTERN = /^(live|test)_sk_[1-9A-HJ-NP-Za-km-z]{32}$/;
/** Skip lastUsedAt writes more often than this, so hot keys don't write on every request. */
const LAST_USED_DEBOUNCE_MS = 60_000;

export type ApiKeyPrincipal = {
	apiKeyId: string;
	organizationId: string;
	mode: Mode;
};

export function createApiKeyService(deps: Deps) {
	const { db } = deps;

	return {
		async list(scope: Scope) {
			const keys = await db.apiKey.findMany({
				where: { organizationId: scope.organizationId, mode: scope.mode },
				orderBy: { createdAt: "desc" },
			});
			return keys.map(serializeApiKey);
		},

		async create(scope: Scope, name: string, actor: Actor) {
			const secret = `${scope.mode}_sk_${randomBase58(32)}`;
			const key = await db.apiKey.create({
				data: {
					id: newId("apiKey"),
					organizationId: scope.organizationId,
					mode: scope.mode,
					name,
					prefix: secret.slice(0, 12),
					hash: sha256Hex(secret),
					last4: secret.slice(-4),
					createdById: actor.id,
				},
			});
			await audit(db, scope, actor, "api_key.create", key.id, { name });
			return { ...serializeApiKey(key), secret };
		},

		async revoke(scope: Scope, id: string, actor: Actor) {
			const { count } = await db.apiKey.updateMany({
				where: {
					id,
					organizationId: scope.organizationId,
					mode: scope.mode,
					revokedAt: null,
				},
				data: { revokedAt: deps.now() },
			});
			if (count === 0) throw errors.notFound("active API key", id);
			await audit(db, scope, actor, "api_key.revoke", id);
			return { ok: true as const };
		},

		/** Resolves a raw `Authorization: Bearer` key, or null if unknown/revoked. */
		async authenticate(rawKey: string): Promise<ApiKeyPrincipal | null> {
			if (!KEY_PATTERN.test(rawKey)) return null;
			const key = await db.apiKey.findUnique({
				where: { hash: sha256Hex(rawKey) },
			});
			if (!key || key.revokedAt) return null;

			const now = deps.now();
			if (
				!key.lastUsedAt ||
				now.getTime() - key.lastUsedAt.getTime() > LAST_USED_DEBOUNCE_MS
			) {
				void db.apiKey
					.update({ where: { id: key.id }, data: { lastUsedAt: now } })
					.catch((error: unknown) =>
						console.error("[api-key] lastUsedAt update failed", error),
					);
			}
			return {
				apiKeyId: key.id,
				organizationId: key.organizationId,
				mode: key.mode,
			};
		},
	};
}

export type ApiKeyService = ReturnType<typeof createApiKeyService>;
