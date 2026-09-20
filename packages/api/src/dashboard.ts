import { os as base, implement, ORPCError } from "@orpc/server";
import { type MemberRole, ROLE_RANK } from "@starpay/auth";
import { dashboardContract, MODE_HEADER } from "@starpay/contracts";
import type { Actor, Scope } from "@starpay/core";

import type { DashboardContext } from "./context";
import { mapDomainErrors } from "./errors";

const os = implement(dashboardContract)
	.$context<DashboardContext>()
	.use(mapDomainErrors);

/** Signed-in user + active organization + membership role + mode header. */
const merchant = os.use(async ({ context, next }) => {
	const session = context.session;
	if (!session?.user) throw new ORPCError("UNAUTHORIZED");

	const organizationId = session.session.activeOrganizationId;
	if (!organizationId) {
		throw new ORPCError("NO_ACTIVE_ORGANIZATION", {
			status: 403,
			message: "Create or select a merchant organization first",
		});
	}
	const member = await context.db.member.findFirst({
		where: { organizationId, userId: session.user.id },
		select: { role: true },
	});
	if (!member || !(member.role in ROLE_RANK)) throw new ORPCError("FORBIDDEN");

	const modeHeader = context.headers.get(MODE_HEADER);
	const mode = modeHeader === "test" ? "test" : "live";
	const scope: Scope = { organizationId, mode };
	const actor: Actor = { type: "user", id: session.user.id };
	return next({ context: { scope, actor, role: member.role as MemberRole } });
});

const requireRole = (minimum: MemberRole) =>
	base
		.$context<{ role: MemberRole }>()
		.middleware(async ({ context, next }) => {
			if (ROLE_RANK[context.role] < ROLE_RANK[minimum]) {
				throw new ORPCError("FORBIDDEN_ROLE", {
					status: 403,
					message: `Requires the ${minimum} role`,
				});
			}
			return next();
		});

/** StarPay staff: signed in and listed in PLATFORM_ADMIN_USER_IDS. No merchant or mode needed. */
const platformAdmin = os.use(async ({ context, next }) => {
	const user = context.session?.user;
	if (!user) throw new ORPCError("UNAUTHORIZED");
	if (!context.services.admin.isPlatformAdmin(user.id))
		throw new ORPCError("FORBIDDEN");
	return next({
		context: { actor: { type: "user", id: user.id } satisfies Actor },
	});
});

const developer = requireRole("developer");
const owner = requireRole("owner");

export const dashboardRouter = os.router({
	onboarding: {
		status: merchant.onboarding.status.handler(({ context }) =>
			context.services.overview.onboarding(context.scope),
		),
	},
	overview: {
		get: merchant.overview.get.handler(({ context, input }) =>
			context.services.analytics.overview(context.scope, input.range, input.tz),
		),
	},
	customers: {
		list: merchant.customers.list.handler(({ context, input }) =>
			context.services.customers.list(context.scope, input),
		),
	},
	subscriptions: {
		stats: merchant.subscriptions.stats.handler(({ context }) =>
			context.services.subscriptions.stats(context.scope),
		),
		list: merchant.subscriptions.list.handler(({ context, input }) =>
			context.services.subscriptions.list(context.scope, input),
		),
	},
	balance: {
		get: merchant.balance.get.handler(({ context }) =>
			context.services.balance.get(context.scope),
		),
		transactions: merchant.balance.transactions.handler(({ context, input }) =>
			context.services.balance.transactions(context.scope, input.offset),
		),
	},
	payouts: {
		balance: merchant.payouts.balance.handler(({ context }) =>
			context.services.payouts.balance(context.scope),
		),
		list: merchant.payouts.list.handler(({ context, input }) =>
			context.services.payouts.list(context.scope, input),
		),
		// Moving money out: owners only.
		request: merchant.payouts.request
			.use(owner)
			.handler(({ context, input }) =>
				context.services.payouts.request(
					context.scope,
					input.amount,
					context.actor,
				),
			),
		cancel: merchant.payouts.cancel
			.use(owner)
			.handler(({ context, input }) =>
				context.services.payouts.cancel(context.scope, input.id, context.actor),
			),
		ledger: merchant.payouts.ledger.handler(({ context, input }) =>
			context.services.payouts.ledger(context.scope, input),
		),
	},
	me: os.me.handler(({ context }) => {
		const user = context.session?.user;
		if (!user) throw new ORPCError("UNAUTHORIZED");
		return {
			user_id: user.id,
			platform_admin: context.services.admin.isPlatformAdmin(user.id),
		};
	}),
	admin: {
		overview: platformAdmin.admin.overview.handler(({ context, input }) =>
			context.services.admin.overview(input.mode),
		),
		payouts: {
			list: platformAdmin.admin.payouts.list.handler(({ context, input }) =>
				context.services.admin.listPayouts(input),
			),
			markPaid: platformAdmin.admin.payouts.markPaid.handler(
				({ context, input }) =>
					context.services.admin.markPaid(
						input.id,
						input.tx_reference,
						context.actor,
					),
			),
			markFailed: platformAdmin.admin.payouts.markFailed.handler(
				({ context, input }) =>
					context.services.admin.markFailed(
						input.id,
						input.reason,
						context.actor,
					),
			),
		},
		recordWithdrawal: platformAdmin.admin.recordWithdrawal.handler(
			({ context, input }) =>
				context.services.admin.recordWithdrawal(input, context.actor),
		),
		feePlans: {
			list: platformAdmin.admin.feePlans.list.handler(({ context }) =>
				context.services.admin.listFeePlans(),
			),
			create: platformAdmin.admin.feePlans.create.handler(
				({ context, input }) => context.services.admin.createFeePlan(input),
			),
			update: platformAdmin.admin.feePlans.update.handler(
				({ context, input }) => {
					const { id, ...changes } = input;
					return context.services.admin.updateFeePlan(id, changes);
				},
			),
			setDefault: platformAdmin.admin.feePlans.setDefault.handler(
				({ context, input }) =>
					context.services.admin.setDefaultFeePlan(input.id),
			),
		},
		merchants: {
			list: platformAdmin.admin.merchants.list.handler(({ context, input }) =>
				context.services.admin.listMerchants(input.mode),
			),
			setFeePlan: platformAdmin.admin.merchants.setFeePlan.handler(
				({ context, input }) =>
					context.services.admin.setMerchantFeePlan(
						input.organization_id,
						input.fee_plan_id,
						context.actor,
					),
			),
		},
		platformBot: {
			connect: platformAdmin.admin.platformBot.connect.handler(
				({ context, input }) =>
					context.services.admin.connectPlatformBot(
						input.mode,
						input.token,
						context.actor,
					),
			),
		},
	},
	bot: {
		get: merchant.bot.get.handler(({ context }) =>
			context.services.bots.get(context.scope),
		),
		connect: merchant.bot.connect
			.use(developer)
			.handler(({ context, input }) =>
				context.services.bots.connect(
					context.scope,
					input.token,
					context.actor,
				),
			),
		refresh: merchant.bot.refresh
			.use(developer)
			.handler(({ context }) => context.services.bots.refresh(context.scope)),
		disconnect: merchant.bot.disconnect
			.use(developer)
			.handler(({ context }) =>
				context.services.bots.disconnect(context.scope, context.actor),
			),
	},
	products: {
		list: merchant.products.list.handler(({ context, input }) =>
			context.services.products.list(context.scope, input),
		),
		create: merchant.products.create
			.use(developer)
			.handler(({ context, input }) =>
				context.services.products.create(context.scope, input),
			),
		update: merchant.products.update
			.use(developer)
			.handler(({ context, input }) =>
				context.services.products.update(context.scope, input),
			),
	},
	orders: {
		list: merchant.orders.list.handler(({ context, input }) =>
			context.services.orders.search(context.scope, input),
		),
		get: merchant.orders.get.handler(({ context, input }) =>
			context.services.orders.detail(context.scope, input.id),
		),
		// Support staff handle refunds, so every role may refund.
		refund: merchant.orders.refund.handler(({ context, input }) =>
			context.services.payments.refund(context.scope, input.id, context.actor),
		),
		cancel: merchant.orders.cancel.handler(({ context, input }) =>
			context.services.orders.cancel(context.scope, input.id, context.actor),
		),
	},
	apiKeys: {
		list: merchant.apiKeys.list
			.use(developer)
			.handler(({ context }) => context.services.apiKeys.list(context.scope)),
		create: merchant.apiKeys.create
			.use(developer)
			.handler(({ context, input }) =>
				context.services.apiKeys.create(
					context.scope,
					input.name,
					context.actor,
				),
			),
		revoke: merchant.apiKeys.revoke
			.use(developer)
			.handler(({ context, input }) =>
				context.services.apiKeys.revoke(context.scope, input.id, context.actor),
			),
	},
	settings: {
		get: merchant.settings.get.handler(({ context }) =>
			context.services.settings.get(context.scope),
		),
		update: merchant.settings.update
			.use(owner)
			.handler(({ context, input }) =>
				context.services.settings.update(context.scope, input, context.actor),
			),
	},
});

export type DashboardRouter = typeof dashboardRouter;
