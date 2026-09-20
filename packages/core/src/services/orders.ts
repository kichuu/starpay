import type {
	CreateOrderInput,
	DashboardListOrdersInput,
	ListOrdersInput,
	OrderDetail,
} from "@starpay/contracts";
import type { OrderStatus, Prisma } from "@starpay/db";
import { TelegramApiError } from "@starpay/telegram";

import type { Actor, Deps, Scope } from "../deps";
import { errors } from "../errors";
import { newId } from "../ids";
import { pageQuery, toPage } from "../pagination";
import { orderInclude, serializeOrder } from "../serializers";
import { audit } from "./audit";
import type { BotService } from "./bots";
import { addOrderEvent, emitEvent } from "./events";
import type { ProductService } from "./products";

/** Orders that can still be paid. */
export const OPEN_STATUSES: OrderStatus[] = ["created", "pre_checkout"];

export function createOrderService(
	deps: Deps,
	bots: BotService,
	products: ProductService,
) {
	const { db } = deps;

	async function load(scope: Scope, id: string) {
		const order = await db.order.findFirst({
			where: { id, organizationId: scope.organizationId, mode: scope.mode },
			include: orderInclude,
		});
		if (!order) throw errors.orderNotFound(id);
		return order;
	}

	async function list(
		scope: Scope,
		args: { limit: number; starting_after?: string },
		where: Prisma.OrderWhereInput,
	) {
		const page = pageQuery(args);
		const rows = await db.order.findMany({
			...page,
			where: {
				...page.where,
				...where,
				organizationId: scope.organizationId,
				mode: scope.mode,
			},
			include: orderInclude,
		});
		return toPage(rows, args.limit, serializeOrder);
	}

	return {
		load,

		async create(scope: Scope, input: CreateOrderInput, actor: Actor) {
			const { bot, settlement } = await bots.invoiceBot(scope);
			const product = await products.resolve(scope, input.product);
			if (product.status === "archived")
				throw errors.productArchived(product.id);

			if (input.delivery === "message") {
				if (!input.telegram_user_id) {
					throw errors.badRequest(
						'delivery "message" needs telegram_user_id',
						"telegram_user_id",
					);
				}
				if (product.type === "subscription") {
					// sendInvoice has no subscription_period; subscriptions need an invoice link.
					throw errors.badRequest(
						'Subscriptions only support delivery "link"',
						"delivery",
					);
				}
			}

			const now = deps.now();
			const order = await db.order.create({
				data: {
					id: newId("order", now.getTime()),
					organizationId: scope.organizationId,
					mode: scope.mode,
					productId: product.id,
					payerTelegramId: input.telegram_user_id
						? BigInt(input.telegram_user_id)
						: null,
					amountStars: product.priceStars,
					title: product.name,
					description: product.description,
					merchantReference: input.reference,
					metadata: input.metadata ?? {},
					expiresAt: new Date(now.getTime() + input.expires_in * 1000),
					apiKeyId: actor.type === "api_key" ? actor.id : null,
					botId: bot.id,
					settlement,
					createdAt: now,
					events: { create: { type: "created", createdAt: now } },
				},
			});

			// The order ID is the invoice payload, so pre-checkout and payment
			// updates find the order without any extra mapping table.
			const invoice = {
				title: product.name,
				description: product.description,
				payload: order.id,
				currency: "XTR" as const,
				prices: [{ label: product.name, amount: product.priceStars }],
				photo_url: product.photoUrl ?? undefined,
			};
			const telegram = bots.clientFor(bot);
			let invoiceLink: string | null = null;
			try {
				if (input.delivery === "message" && input.telegram_user_id) {
					await telegram.sendInvoice({
						...invoice,
						chat_id: input.telegram_user_id,
					});
				} else {
					invoiceLink = await telegram.createInvoiceLink({
						...invoice,
						subscription_period: product.periodSeconds ?? undefined,
					});
				}
			} catch (error) {
				const description =
					error instanceof TelegramApiError ? error.description : String(error);
				await db.order.update({
					where: { id: order.id },
					data: {
						status: "failed",
						failureReason: `telegram_error: ${description}`,
					},
				});
				throw errors.telegram(description);
			}

			if (invoiceLink) {
				await db.order.update({
					where: { id: order.id },
					data: { invoiceLink },
				});
			}
			return serializeOrder(await load(scope, order.id));
		},

		async retrieve(scope: Scope, id: string) {
			return serializeOrder(await load(scope, id));
		},

		/** Public API filters. */
		list(scope: Scope, input: ListOrdersInput) {
			return list(scope, input, {
				status: input.status,
				payerTelegramId: input.telegram_user_id
					? BigInt(input.telegram_user_id)
					: undefined,
				merchantReference: input.reference,
			});
		},

		/** Dashboard search: order ID, @username, Telegram ID, charge ID or reference. */
		search(scope: Scope, input: DashboardListOrdersInput) {
			const q = input.q?.trim();
			let match: Prisma.OrderWhereInput = {};
			if (q) {
				if (q.startsWith("ord_")) match = { id: { startsWith: q } };
				else if (q.startsWith("@"))
					match = {
						customer: { username: { equals: q.slice(1), mode: "insensitive" } },
					};
				else if (/^\d+$/.test(q)) {
					const id = BigInt(q);
					match = {
						OR: [{ payerTelegramId: id }, { customer: { telegramUserId: id } }],
					};
				} else {
					match = {
						OR: [
							{ merchantReference: q },
							{ payments: { some: { telegramChargeId: q } } },
							{ title: { contains: q, mode: "insensitive" } },
						],
					};
				}
			}
			return list(scope, input, { ...match, status: input.status });
		},

		async detail(scope: Scope, id: string): Promise<OrderDetail> {
			const order = await load(scope, id);
			const [events, payment] = await Promise.all([
				db.orderEvent.findMany({
					where: { orderId: id },
					// cuid IDs break ties between events recorded in the same millisecond.
					orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				}),
				db.payment.findFirst({
					where: { orderId: id },
					orderBy: { createdAt: "asc" },
				}),
			]);
			return {
				order: serializeOrder(order),
				timeline: events.map((event) => ({
					type: event.type,
					data: (event.data ?? {}) as Record<string, unknown>,
					created_at: event.createdAt.toISOString(),
				})),
				raw_payment: (payment?.raw ?? null) as Record<string, unknown> | null,
			};
		},

		async cancel(scope: Scope, id: string, actor: Actor) {
			const order = await load(scope, id);
			const now = deps.now();
			const result = await db.$transaction(async (tx) => {
				const { count } = await tx.order.updateMany({
					where: { id, status: { in: OPEN_STATUSES } },
					data: { status: "expired", failureReason: "cancelled" },
				});
				if (count === 0) return null;
				await addOrderEvent(tx, id, "expired", now, { reason: "cancelled" });
				const updated = serializeOrder(
					await tx.order.findUniqueOrThrow({
						where: { id },
						include: orderInclude,
					}),
				);
				await emitEvent(tx, scope, "order.expired", updated, now);
				await audit(tx, scope, actor, "order.cancel", id);
				return updated;
			});
			if (!result) throw errors.orderNotCancellable(id, order.status);
			return result;
		},
	};
}

export type OrderService = ReturnType<typeof createOrderService>;
