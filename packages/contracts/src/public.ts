// Public REST API, served under /v1 with API-key auth. Paths are relative to /v1.
import { oc } from "@orpc/contract";
import { z } from "zod";

import {
	ListInput,
	listOf,
	Metadata,
	prefixedId,
	Stars,
	TelegramId,
} from "./common";
import {
	BalanceObject,
	OrderObject,
	OrderStatus,
	ProductObject,
	ProductStatus,
	ProductType,
} from "./objects";

// ── Orders ──

export const CreateOrderInput = z.object({
	/** Product ID (prod_…) or lookup key. */
	product: z.string().min(1).max(64),
	telegram_user_id: TelegramId.optional(),
	reference: z.string().max(128).optional(),
	metadata: Metadata.optional(),
	/** Seconds until the invoice stops accepting payment. */
	expires_in: z.int().min(60).max(86_400).default(3_600),
	/** "message" sends the invoice to the user's chat (requires telegram_user_id). */
	delivery: z.enum(["link", "message"]).default("link"),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInput>;

export const ListOrdersInput = ListInput.extend({
	status: OrderStatus.optional(),
	telegram_user_id: TelegramId.optional(),
	reference: z.string().max(128).optional(),
});
export type ListOrdersInput = z.infer<typeof ListOrdersInput>;

const OrderIdInput = z.object({ id: prefixedId("ord") });

export const ordersContract = {
	create: oc
		.route({
			method: "POST",
			path: "/orders",
			successStatus: 201,
			tags: ["Orders"],
			summary: "Create an order and its Telegram invoice link",
		})
		.input(CreateOrderInput)
		.output(OrderObject),
	retrieve: oc
		.route({ method: "GET", path: "/orders/{id}", tags: ["Orders"] })
		.input(OrderIdInput)
		.output(OrderObject),
	list: oc
		.route({ method: "GET", path: "/orders", tags: ["Orders"] })
		.input(ListOrdersInput)
		.output(listOf(OrderObject)),
	refund: oc
		.route({
			method: "POST",
			path: "/orders/{id}/refund",
			tags: ["Orders"],
			summary: "Refund a paid order in full",
		})
		.input(OrderIdInput)
		.output(OrderObject),
	cancel: oc
		.route({
			method: "POST",
			path: "/orders/{id}/cancel",
			tags: ["Orders"],
			summary: "Expire an unpaid order early",
		})
		.input(OrderIdInput)
		.output(OrderObject),
};

// ── Products ──

export const CreateProductInput = z
	.object({
		lookup_key: z
			.string()
			.regex(/^[a-z0-9_.-]{1,64}$/, "lowercase letters, digits, _ . -")
			.optional(),
		// Telegram invoice limits: title 1–32, description 1–255.
		name: z.string().min(1).max(32),
		description: z.string().min(1).max(255),
		photo_url: z.url().optional(),
		price: Stars.min(1).max(100_000),
		type: ProductType.default("one_time"),
		metadata: Metadata.optional(),
	})
	.strict();
export type CreateProductInput = z.infer<typeof CreateProductInput>;

export const UpdateProductInput = z
	.object({
		id: prefixedId("prod"),
		name: z.string().min(1).max(32).optional(),
		description: z.string().min(1).max(255).optional(),
		photo_url: z.url().nullable().optional(),
		price: Stars.min(1).max(100_000).optional(),
		status: ProductStatus.optional(),
		metadata: Metadata.optional(),
	})
	.strict();
export type UpdateProductInput = z.infer<typeof UpdateProductInput>;

export const ListProductsInput = ListInput.extend({
	status: ProductStatus.optional(),
});

export const productsContract = {
	create: oc
		.route({
			method: "POST",
			path: "/products",
			successStatus: 201,
			tags: ["Products"],
		})
		.input(CreateProductInput)
		.output(ProductObject),
	retrieve: oc
		.route({ method: "GET", path: "/products/{id}", tags: ["Products"] })
		.input(z.object({ id: prefixedId("prod") }))
		.output(ProductObject),
	list: oc
		.route({ method: "GET", path: "/products", tags: ["Products"] })
		.input(ListProductsInput)
		.output(listOf(ProductObject)),
	update: oc
		.route({ method: "PATCH", path: "/products/{id}", tags: ["Products"] })
		.input(UpdateProductInput)
		.output(ProductObject),
};

// ── Balance ──

export const balanceContract = {
	retrieve: oc
		.route({ method: "GET", path: "/balance", tags: ["Balance"] })
		.output(BalanceObject),
};

export const publicContract = {
	orders: ordersContract,
	products: productsContract,
	balance: balanceContract,
};
export type PublicContract = typeof publicContract;
