// Outgoing merchant webhooks. Exported so merchant SDKs can validate payloads.
import { z } from "zod";

import { prefixedId, Timestamp } from "./common";
import { OrderObject, SubscriptionObject } from "./objects";

export const WebhookEventType = z.enum([
	"payment.succeeded",
	"payment.refunded",
	"payment.failed",
	"order.expired",
	"subscription.renewed",
	"subscription.cancelled",
	"subscription.expired",
]);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

export const WebhookEventEnvelope = z.object({
	id: prefixedId("evt"),
	object: z.literal("event"),
	type: WebhookEventType,
	livemode: z.boolean(),
	created_at: Timestamp,
	data: z.object({ object: z.union([OrderObject, SubscriptionObject]) }),
});
export type WebhookEventEnvelope = z.infer<typeof WebhookEventEnvelope>;

export const SIGNATURE_HEADER = "x-starpay-signature";
export const EVENT_ID_HEADER = "x-starpay-event-id";
export const EVENT_TYPE_HEADER = "x-starpay-event-type";
