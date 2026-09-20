// Merchant webhooks: endpoints, signing, delivery with retries, and a full
// request/response trail for every attempt.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import {
	EVENT_ID_HEADER,
	EVENT_TYPE_HEADER,
	SIGNATURE_HEADER,
	type WebhookEventType,
} from "@starpay/contracts";
import type {
	Mode,
	WebhookDelivery,
	WebhookEndpoint,
	WebhookEvent,
} from "@starpay/db";

import { hmacSha256Hex, randomBase58 } from "../crypto";
import type { Actor, Deps, Scope } from "../deps";
import { errors } from "../errors";
import { newId } from "../ids";
import { toJson } from "../serializers";
import { audit } from "./audit";

/** Retry schedule after a failed attempt (seconds), ±20% jitter. */
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21_600];
const REQUEST_TIMEOUT_MS = 10_000;
/** Stored request/response bodies are capped; the full body stays with the merchant. */
const BODY_LIMIT = 4096;
const LOCK_SECONDS = 60;
/** How long the previous secret keeps signing after a rotation. */
const ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000;

const truncate = (text: string) =>
	text.length > BODY_LIMIT
		? `${text.slice(0, BODY_LIMIT)}… (${text.length} bytes)`
		: text;

/** Blocks loopback, private, link-local and unique-local addresses. */
function isPrivateAddress(address: string): boolean {
	if (isIP(address) === 4) {
		const [a = 0, b = 0] = address.split(".").map(Number);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168)
		);
	}
	const lower = address.toLowerCase();
	return (
		lower === "::1" ||
		lower === "::" ||
		lower.startsWith("fe80") ||
		lower.startsWith("fc") ||
		lower.startsWith("fd")
	);
}

/**
 * Endpoints must be public HTTPS URLs: a webhook pointed at an internal address
 * would turn StarPay into a proxy into its own network (SSRF). Test mode allows
 * http and localhost so merchants can develop against their machine.
 */
export async function assertDeliverableUrl(
	rawUrl: string,
	mode: Mode,
): Promise<void> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw errors.badRequest("That isn't a valid URL", "url");
	}
	const isHttps = url.protocol === "https:";
	if (!isHttps && !(mode === "test" && url.protocol === "http:")) {
		throw errors.badRequest("Webhook URLs must use https", "url");
	}
	const addresses = isIP(url.hostname)
		? [{ address: url.hostname }]
		: await lookup(url.hostname, { all: true }).catch(() => {
				throw errors.badRequest(`Can't resolve ${url.hostname}`, "url");
			});
	const privateAddress = addresses.some((entry) =>
		isPrivateAddress(entry.address),
	);
	if (privateAddress && mode !== "test") {
		throw errors.badRequest(
			"That address is not reachable from the internet",
			"url",
		);
	}
}

export type SignedRequest = { body: string; headers: Record<string, string> };

/** `t=<unix>,v1=<hmac>` over `timestamp.body`, with both secrets during a rotation. */
export function signPayload(
	body: string,
	secrets: string[],
	event: { id: string; type: string },
	attempt: number,
	now: Date,
): SignedRequest {
	const timestamp = Math.floor(now.getTime() / 1000);
	const signatures = secrets.map(
		(secret) => `v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`,
	);
	return {
		body,
		headers: {
			"content-type": "application/json",
			"user-agent": "StarPay/1.0 (+https://starpay.dev)",
			[SIGNATURE_HEADER]: [`t=${timestamp}`, ...signatures].join(","),
			[EVENT_ID_HEADER]: event.id,
			[EVENT_TYPE_HEADER]: event.type,
			"x-starpay-attempt": String(attempt),
		},
	};
}

type DeliveryJob = WebhookDelivery & {
	event: WebhookEvent;
	endpoint: WebhookEndpoint;
};

export function createWebhookService(deps: Deps) {
	const { db, box } = deps;

	function envelope(event: WebhookEvent) {
		return JSON.stringify({
			id: event.id,
			object: "event",
			type: event.type,
			livemode: event.mode === "live",
			created_at: event.createdAt.toISOString(),
			data: { object: event.data },
		});
	}

	function secretsFor(endpoint: WebhookEndpoint, now: Date): string[] {
		const secrets = [box.decrypt(endpoint.secretEncrypted)];
		if (
			endpoint.prevSecretEncrypted &&
			endpoint.prevSecretExpiresAt &&
			endpoint.prevSecretExpiresAt > now
		) {
			secrets.push(box.decrypt(endpoint.prevSecretEncrypted));
		}
		return secrets;
	}

	function backoff(attempt: number, now: Date): Date {
		const base =
			BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length) - 1] ?? 21_600;
		const jitter = base * (0.8 + Math.random() * 0.4);
		return new Date(now.getTime() + jitter * 1000);
	}

	/** Sends one delivery and records exactly what was sent and what came back. */
	async function attemptDelivery(job: DeliveryJob) {
		const now = deps.now();
		const attempt = job.attempts + 1;
		const body = envelope(job.event);
		const signed = signPayload(
			body,
			secretsFor(job.endpoint, now),
			job.event,
			attempt,
			now,
		);
		const startedAt = Date.now();

		let statusCode: number | null = null;
		let responseHeaders: Record<string, string> = {};
		let responseBody: string | null = null;
		let error: string | null = null;
		try {
			const response = await fetch(job.endpoint.url, {
				method: "POST",
				headers: signed.headers,
				body: signed.body,
				// Following a redirect could land on an internal address.
				redirect: "manual",
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			statusCode = response.status;
			responseHeaders = Object.fromEntries(response.headers.entries());
			responseBody = truncate(await response.text().catch(() => ""));
			if (statusCode >= 300 && statusCode < 400)
				error = "Redirects are not followed";
			else if (statusCode < 200 || statusCode >= 300)
				error = `HTTP ${statusCode}`;
		} catch (cause) {
			error =
				cause instanceof Error
					? cause.name === "TimeoutError"
						? `No response within ${REQUEST_TIMEOUT_MS / 1000}s`
						: `${cause.name}: ${cause.message}`
					: String(cause);
		}
		const latencyMs = Date.now() - startedAt;
		const succeeded = error === null;

		await db.$transaction(async (tx) => {
			await tx.webhookAttempt.create({
				data: {
					deliveryId: job.id,
					attempt,
					url: job.endpoint.url,
					requestHeaders: toJson(signed.headers),
					requestBody: truncate(signed.body),
					statusCode,
					responseHeaders: toJson(responseHeaders),
					responseBody,
					latencyMs,
					error,
					createdAt: now,
				},
			});
			const exhausted = !succeeded && attempt >= job.maxAttempts;
			await tx.webhookDelivery.update({
				where: { id: job.id },
				data: {
					attempts: attempt,
					status: succeeded ? "succeeded" : exhausted ? "failed" : "pending",
					deliveredAt: succeeded ? now : null,
					nextAttemptAt:
						succeeded || exhausted ? job.nextAttemptAt : backoff(attempt, now),
					lockedUntil: null,
					lastStatusCode: statusCode,
					lastLatencyMs: latencyMs,
					lastError: error,
					lastResponse: responseBody,
				},
			});
			if (!succeeded) {
				await tx.webhookEndpoint.update({
					where: { id: job.endpointId },
					data: { lastFailureAt: now },
				});
			}
			// Show delivery outcomes on the order's timeline.
			if (job.event.orderId && (succeeded || exhausted)) {
				await tx.orderEvent.create({
					data: {
						orderId: job.event.orderId,
						type: succeeded ? "webhook_delivered" : "webhook_failed",
						data: toJson({
							endpoint: job.endpoint.url,
							attempt,
							status: statusCode,
							error,
						}),
						createdAt: now,
					},
				});
			}
		});
		return { succeeded, statusCode, error, latencyMs };
	}

	return {
		attemptDelivery,

		/**
		 * Claims due deliveries with SKIP LOCKED and sends them, so several
		 * server instances can run this at once without doubling up.
		 */
		async dispatchDue(limit = 20) {
			// The injected clock decides what is due, so tests can move time.
			const now = deps.now();
			const claimed = await db.$queryRaw<{ id: string }[]>`
				UPDATE webhook_delivery
				SET "lockedUntil" = ${now}::timestamptz + make_interval(secs => ${LOCK_SECONDS}::int)
				WHERE id IN (
					SELECT id FROM webhook_delivery
					WHERE status = 'pending' AND "nextAttemptAt" <= ${now}::timestamptz
						AND ("lockedUntil" IS NULL OR "lockedUntil" < ${now}::timestamptz)
					ORDER BY "nextAttemptAt"
					LIMIT ${limit}
					FOR UPDATE SKIP LOCKED
				)
				RETURNING id`;
			if (claimed.length === 0) return 0;

			const jobs = await db.webhookDelivery.findMany({
				where: { id: { in: claimed.map((row) => row.id) } },
				include: { event: true, endpoint: true },
			});
			let sent = 0;
			for (const job of jobs) {
				if (job.endpoint.status !== "active") {
					await db.webhookDelivery.update({
						where: { id: job.id },
						data: {
							status: "failed",
							lastError: "Endpoint is disabled",
							lockedUntil: null,
						},
					});
					continue;
				}
				await attemptDelivery(job);
				sent++;
			}
			return sent;
		},

		// ── Endpoints ──

		async listEndpoints(scope: Scope) {
			return db.webhookEndpoint.findMany({
				where: { organizationId: scope.organizationId, mode: scope.mode },
				orderBy: { createdAt: "asc" },
			});
		},

		async createEndpoint(
			scope: Scope,
			input: { url: string; events: string[]; description?: string },
			actor: Actor,
		) {
			await assertDeliverableUrl(input.url, scope.mode);
			const endpoint = await db.webhookEndpoint.create({
				data: {
					id: newId("endpoint"),
					organizationId: scope.organizationId,
					mode: scope.mode,
					url: input.url,
					events: input.events,
					description: input.description,
					secretEncrypted: box.encrypt(`whsec_${randomBase58(40)}`),
				},
			});
			await audit(db, scope, actor, "webhook.create", endpoint.id, {
				url: input.url,
			});
			return endpoint;
		},

		async updateEndpoint(
			scope: Scope,
			input: {
				id: string;
				url?: string;
				events?: string[];
				description?: string | null;
				status?: "active" | "disabled";
			},
			actor: Actor,
		) {
			const endpoint = await db.webhookEndpoint.findFirst({
				where: {
					id: input.id,
					organizationId: scope.organizationId,
					mode: scope.mode,
				},
			});
			if (!endpoint) throw errors.notFound("webhook endpoint", input.id);
			if (input.url && input.url !== endpoint.url)
				await assertDeliverableUrl(input.url, scope.mode);
			const updated = await db.webhookEndpoint.update({
				where: { id: endpoint.id },
				data: {
					url: input.url,
					events: input.events,
					description: input.description,
					status: input.status,
					disabledAt:
						input.status === "disabled"
							? deps.now()
							: input.status === "active"
								? null
								: undefined,
				},
			});
			await audit(db, scope, actor, "webhook.update", endpoint.id, {
				...input,
			});
			return updated;
		},

		async deleteEndpoint(scope: Scope, id: string, actor: Actor) {
			const { count } = await db.webhookEndpoint.deleteMany({
				where: { id, organizationId: scope.organizationId, mode: scope.mode },
			});
			if (count === 0) throw errors.notFound("webhook endpoint", id);
			await audit(db, scope, actor, "webhook.delete", id);
			return { ok: true as const };
		},

		/** The signing secret, in plaintext. Every reveal is audited. */
		async revealSecret(scope: Scope, id: string, actor: Actor) {
			const endpoint = await db.webhookEndpoint.findFirst({
				where: { id, organizationId: scope.organizationId, mode: scope.mode },
			});
			if (!endpoint) throw errors.notFound("webhook endpoint", id);
			await audit(db, scope, actor, "webhook.reveal_secret", id);
			return { secret: box.decrypt(endpoint.secretEncrypted) };
		},

		/** New secret now; the old one keeps signing for 24 hours so deployments can catch up. */
		async rotateSecret(scope: Scope, id: string, actor: Actor) {
			const endpoint = await db.webhookEndpoint.findFirst({
				where: { id, organizationId: scope.organizationId, mode: scope.mode },
			});
			if (!endpoint) throw errors.notFound("webhook endpoint", id);
			const now = deps.now();
			const secret = `whsec_${randomBase58(40)}`;
			await db.webhookEndpoint.update({
				where: { id },
				data: {
					secretEncrypted: box.encrypt(secret),
					prevSecretEncrypted: endpoint.secretEncrypted,
					prevSecretExpiresAt: new Date(now.getTime() + ROTATION_OVERLAP_MS),
					secretRotatedAt: now,
				},
			});
			await audit(db, scope, actor, "webhook.rotate_secret", id);
			return { secret };
		},

		// ── Deliveries ──

		async listDeliveries(
			scope: Scope,
			args: {
				endpointId?: string;
				status?: "pending" | "succeeded" | "failed";
				limit: number;
				starting_after?: string;
			},
		) {
			const rows = await db.webhookDelivery.findMany({
				where: {
					...(args.starting_after ? { id: { lt: args.starting_after } } : {}),
					endpointId: args.endpointId,
					status: args.status,
					event: { organizationId: scope.organizationId, mode: scope.mode },
				},
				orderBy: { id: "desc" },
				take: args.limit + 1,
				include: {
					event: { select: { type: true, orderId: true } },
					endpoint: { select: { url: true } },
				},
			});
			return rows;
		},

		/** One delivery with every attempt: what was sent, what came back. */
		async getDelivery(scope: Scope, id: string) {
			const delivery = await db.webhookDelivery.findFirst({
				where: {
					id,
					event: { organizationId: scope.organizationId, mode: scope.mode },
				},
				include: {
					event: true,
					endpoint: { select: { url: true, description: true } },
					attemptLog: { orderBy: { attempt: "asc" } },
				},
			});
			if (!delivery) throw errors.notFound("delivery", id);
			return delivery;
		},

		/** Queues the same event again as a new delivery, keeping the old trail. */
		async resend(scope: Scope, id: string, actor: Actor) {
			const delivery = await db.webhookDelivery.findFirst({
				where: {
					id,
					event: { organizationId: scope.organizationId, mode: scope.mode },
				},
			});
			if (!delivery) throw errors.notFound("delivery", id);
			const created = await db.webhookDelivery.create({
				data: {
					id: newId("delivery"),
					eventId: delivery.eventId,
					endpointId: delivery.endpointId,
					nextAttemptAt: deps.now(),
				},
			});
			await audit(db, scope, actor, "webhook.resend", id, {
				deliveryId: created.id,
			});
			return created;
		},

		/** Sends a sample event immediately so a merchant can check their endpoint. */
		async sendTest(
			scope: Scope,
			endpointId: string,
			type: WebhookEventType,
			actor: Actor,
		) {
			const endpoint = await db.webhookEndpoint.findFirst({
				where: {
					id: endpointId,
					organizationId: scope.organizationId,
					mode: scope.mode,
				},
			});
			if (!endpoint) throw errors.notFound("webhook endpoint", endpointId);

			const now = deps.now();
			const event = await db.webhookEvent.create({
				data: {
					id: newId("event", now.getTime()),
					organizationId: scope.organizationId,
					mode: scope.mode,
					type,
					data: toJson({
						id: "ord_00000000000000000000000000",
						object: "order",
						livemode: scope.mode === "live",
						status: "paid",
						amount: 250,
						currency: "XTR",
						product: {
							id: "prod_00000000000000000000000000",
							name: "Test product",
							type: "one_time",
						},
						telegram_user_id: null,
						customer: null,
						reference: "test-event",
						metadata: { test: "true" },
						invoice_link: null,
						telegram_payment_charge_id: null,
						settlement: "direct",
						fee: null,
						subscription_id: null,
						expires_at: now.toISOString(),
						paid_at: now.toISOString(),
						refunded_at: null,
						created_at: now.toISOString(),
					}),
					createdAt: now,
				},
			});
			const delivery = await db.webhookDelivery.create({
				data: {
					id: newId("delivery", now.getTime()),
					eventId: event.id,
					endpointId,
					nextAttemptAt: now,
				},
			});
			await audit(db, scope, actor, "webhook.test", endpointId, { type });
			const result = await attemptDelivery({ ...delivery, event, endpoint });
			return { deliveryId: delivery.id, ...result };
		},
	};
}

export type WebhookService = ReturnType<typeof createWebhookService>;
export type { DeliveryJob };
