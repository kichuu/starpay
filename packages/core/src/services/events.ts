import type {
	OrderObject,
	SubscriptionObject,
	WebhookEventType,
} from "@starpay/contracts";
import type { Tx } from "@starpay/db";

import type { Scope } from "../deps";
import { newId } from "../ids";
import { toJson } from "../serializers";

/**
 * Outbox write: records the event and one pending delivery per subscribed
 * endpoint. Call it inside the same transaction as the state change so an
 * event exists if and only if the change committed.
 */
export async function emitEvent(
	tx: Tx,
	scope: Scope,
	type: WebhookEventType,
	object: OrderObject | SubscriptionObject,
	now: Date,
) {
	const event = await tx.webhookEvent.create({
		data: {
			id: newId("event", now.getTime()),
			organizationId: scope.organizationId,
			mode: scope.mode,
			type,
			orderId: object.object === "order" ? object.id : null,
			data: toJson(object),
			createdAt: now,
		},
	});

	const endpoints = await tx.webhookEndpoint.findMany({
		where: {
			organizationId: scope.organizationId,
			mode: scope.mode,
			status: "active",
			OR: [{ events: { isEmpty: true } }, { events: { has: type } }],
		},
		select: { id: true },
	});

	if (endpoints.length > 0) {
		await tx.webhookDelivery.createMany({
			data: endpoints.map((endpoint) => ({
				id: newId("delivery", now.getTime()),
				eventId: event.id,
				endpointId: endpoint.id,
				nextAttemptAt: now,
			})),
		});
	}
	return event;
}

export async function addOrderEvent(
	tx: Tx,
	orderId: string,
	type: string,
	now: Date,
	data: Record<string, unknown> = {},
): Promise<void> {
	await tx.orderEvent.create({
		data: { orderId, type, data: toJson(data), createdAt: now },
	});
}
