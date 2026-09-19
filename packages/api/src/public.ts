import { implement, ORPCError } from "@orpc/server";
import { publicContract } from "@starpay/contracts";
import type { Actor, Scope } from "@starpay/core";

import type { PublicContext } from "./context";
import { mapDomainErrors } from "./errors";

const os = implement(publicContract)
	.$context<PublicContext>()
	.use(mapDomainErrors);

/** `Authorization: Bearer live_sk_…`; the key decides organization and mode. */
const authed = os.use(async ({ context, next }) => {
	const header = context.headers.get("authorization") ?? "";
	const rawKey = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
	const principal = rawKey
		? await context.services.apiKeys.authenticate(rawKey)
		: null;
	if (!principal) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Missing or invalid API key",
		});
	}
	const scope: Scope = {
		organizationId: principal.organizationId,
		mode: principal.mode,
	};
	const actor: Actor = { type: "api_key", id: principal.apiKeyId };
	return next({
		context: {
			scope,
			actor,
			idempotencyKey: context.headers.get("idempotency-key") ?? undefined,
		},
	});
});

export const publicRouter = authed.router({
	orders: {
		create: authed.orders.create.handler(({ context, input }) =>
			context.services.idempotency.run(
				context.scope,
				context.idempotencyKey,
				["orders.create", input],
				() =>
					context.services.orders.create(context.scope, input, context.actor),
			),
		),
		retrieve: authed.orders.retrieve.handler(({ context, input }) =>
			context.services.orders.retrieve(context.scope, input.id),
		),
		list: authed.orders.list.handler(({ context, input }) =>
			context.services.orders.list(context.scope, input),
		),
		refund: authed.orders.refund.handler(({ context, input }) =>
			context.services.idempotency.run(
				context.scope,
				context.idempotencyKey,
				["orders.refund", input],
				() =>
					context.services.payments.refund(
						context.scope,
						input.id,
						context.actor,
					),
			),
		),
		cancel: authed.orders.cancel.handler(({ context, input }) =>
			context.services.orders.cancel(context.scope, input.id, context.actor),
		),
	},
	products: {
		create: authed.products.create.handler(({ context, input }) =>
			context.services.idempotency.run(
				context.scope,
				context.idempotencyKey,
				["products.create", input],
				() => context.services.products.create(context.scope, input),
			),
		),
		retrieve: authed.products.retrieve.handler(({ context, input }) =>
			context.services.products.retrieve(context.scope, input.id),
		),
		list: authed.products.list.handler(({ context, input }) =>
			context.services.products.list(context.scope, input),
		),
		update: authed.products.update.handler(({ context, input }) =>
			context.services.products.update(context.scope, input),
		),
	},
	balance: {
		retrieve: authed.balance.retrieve.handler(({ context }) =>
			context.services.balance.get(context.scope),
		),
	},
});

export type PublicRouter = typeof publicRouter;
