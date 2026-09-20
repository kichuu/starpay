// Webhook endpoints and their delivery trail (merchant dashboard).
import { oc } from "@orpc/contract";
import { z } from "zod";

import { ListInput, listOf, prefixedId, Timestamp } from "./common";
import { WebhookEventType } from "./webhooks";

export const EndpointStatus = z.enum(["active", "disabled"]);

export const WebhookEndpointView = z.object({
	id: prefixedId("we"),
	url: z.string(),
	description: z.string().nullable(),
	/** Empty = every event. */
	events: z.array(z.string()),
	status: EndpointStatus,
	secret_rotated_at: Timestamp.nullable(),
	last_failure_at: Timestamp.nullable(),
	created_at: Timestamp,
});
export type WebhookEndpointView = z.infer<typeof WebhookEndpointView>;

export const DeliveryStatus = z.enum(["pending", "succeeded", "failed"]);

export const DeliveryView = z.object({
	id: prefixedId("whd"),
	event_id: prefixedId("evt"),
	event_type: z.string(),
	order_id: z.string().nullable(),
	endpoint_id: prefixedId("we"),
	endpoint_url: z.string(),
	status: DeliveryStatus,
	attempts: z.int(),
	max_attempts: z.int(),
	last_status_code: z.int().nullable(),
	last_latency_ms: z.int().nullable(),
	last_error: z.string().nullable(),
	next_attempt_at: Timestamp.nullable(),
	delivered_at: Timestamp.nullable(),
	created_at: Timestamp,
});
export type DeliveryView = z.infer<typeof DeliveryView>;

/** Exactly what StarPay sent and what the endpoint answered. */
export const AttemptView = z.object({
	attempt: z.int(),
	url: z.string(),
	request_headers: z.record(z.string(), z.string()),
	request_body: z.string().nullable(),
	status_code: z.int().nullable(),
	response_headers: z.record(z.string(), z.string()),
	response_body: z.string().nullable(),
	latency_ms: z.int().nullable(),
	error: z.string().nullable(),
	created_at: Timestamp,
});

export const DeliveryDetail = z.object({
	delivery: DeliveryView,
	attempts: z.array(AttemptView),
});

const EndpointInput = z.object({
	url: z.url().max(500),
	events: z.array(WebhookEventType).max(20).default([]),
	description: z.string().max(200).optional(),
});

export const webhooksContract = {
	endpoints: {
		list: oc.output(z.array(WebhookEndpointView)),
		create: oc.input(EndpointInput).output(WebhookEndpointView),
		update: oc
			.input(
				EndpointInput.partial().extend({
					id: prefixedId("we"),
					status: EndpointStatus.optional(),
				}),
			)
			.output(WebhookEndpointView),
		delete: oc
			.input(z.object({ id: prefixedId("we") }))
			.output(z.object({ ok: z.literal(true) })),
		revealSecret: oc
			.input(z.object({ id: prefixedId("we") }))
			.output(z.object({ secret: z.string() })),
		rotateSecret: oc
			.input(z.object({ id: prefixedId("we") }))
			.output(z.object({ secret: z.string() })),
		sendTest: oc
			.input(
				z.object({
					id: prefixedId("we"),
					type: WebhookEventType.default("payment.succeeded"),
				}),
			)
			.output(
				z.object({
					delivery_id: prefixedId("whd"),
					succeeded: z.boolean(),
					status_code: z.int().nullable(),
					error: z.string().nullable(),
					latency_ms: z.int(),
				}),
			),
	},
	deliveries: {
		list: oc
			.input(
				ListInput.extend({
					endpoint_id: prefixedId("we").optional(),
					status: DeliveryStatus.optional(),
				}),
			)
			.output(listOf(DeliveryView)),
		get: oc.input(z.object({ id: prefixedId("whd") })).output(DeliveryDetail),
		resend: oc.input(z.object({ id: prefixedId("whd") })).output(DeliveryView),
	},
};
