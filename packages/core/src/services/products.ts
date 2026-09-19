import type {
	CreateProductInput,
	UpdateProductInput,
} from "@starpay/contracts";
import { Prisma } from "@starpay/db";
import { STAR_SUBSCRIPTION_PERIOD } from "@starpay/telegram";

import type { Deps, Scope } from "../deps";
import { errors } from "../errors";
import { newId } from "../ids";
import { type PageArgs, pageQuery, toPage } from "../pagination";
import { serializeProduct } from "../serializers";

export function createProductService(deps: Deps) {
	const { db } = deps;

	/** Accepts a product ID or lookup key. */
	async function resolve(scope: Scope, idOrLookupKey: string) {
		const where = idOrLookupKey.startsWith("prod_")
			? { id: idOrLookupKey }
			: { lookupKey: idOrLookupKey };
		const product = await db.product.findFirst({
			where: {
				...where,
				organizationId: scope.organizationId,
				mode: scope.mode,
			},
		});
		if (!product) throw errors.productNotFound(idOrLookupKey);
		return product;
	}

	return {
		resolve,

		async create(scope: Scope, input: CreateProductInput) {
			try {
				const product = await db.product.create({
					data: {
						id: newId("product"),
						organizationId: scope.organizationId,
						mode: scope.mode,
						lookupKey: input.lookup_key,
						name: input.name,
						description: input.description,
						photoUrl: input.photo_url,
						priceStars: input.price,
						type: input.type,
						periodSeconds:
							input.type === "subscription" ? STAR_SUBSCRIPTION_PERIOD : null,
						metadata: input.metadata ?? {},
					},
				});
				return serializeProduct(product);
			} catch (error) {
				if (
					error instanceof Prisma.PrismaClientKnownRequestError &&
					error.code === "P2002"
				) {
					throw errors.conflict(
						`lookup_key "${input.lookup_key}" is already used`,
					);
				}
				throw error;
			}
		},

		async retrieve(scope: Scope, id: string) {
			return serializeProduct(await resolve(scope, id));
		},

		async list(
			scope: Scope,
			args: PageArgs & { status?: "active" | "archived" },
		) {
			const page = pageQuery(args);
			const rows = await db.product.findMany({
				...page,
				where: {
					...page.where,
					organizationId: scope.organizationId,
					mode: scope.mode,
					status: args.status,
				},
			});
			return toPage(rows, args.limit, serializeProduct);
		},

		async update(scope: Scope, input: UpdateProductInput) {
			const product = await resolve(scope, input.id);
			// Price changes only affect new orders: each order snapshots its amount.
			const updated = await db.product.update({
				where: { id: product.id },
				data: {
					name: input.name,
					description: input.description,
					photoUrl: input.photo_url,
					priceStars: input.price,
					status: input.status,
					metadata: input.metadata,
				},
			});
			return serializeProduct(updated);
		},
	};
}

export type ProductService = ReturnType<typeof createProductService>;
