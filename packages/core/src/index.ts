import type { Deps } from "./deps";
import { createApiKeyService } from "./services/api-keys";
import { createBotService } from "./services/bots";
import { createIdempotencyService } from "./services/idempotency";
import { createOrderService } from "./services/orders";
import { createOverviewService } from "./services/overview";
import { createPaymentService } from "./services/payments";
import { createProductService } from "./services/products";
import { createSettingsService } from "./services/settings";
import { createTelegramUpdateService } from "./services/telegram-updates";

export function createServices(deps: Deps) {
	const bots = createBotService(deps);
	const products = createProductService(deps);
	const orders = createOrderService(deps, bots, products);
	const payments = createPaymentService(deps, bots);
	return {
		bots,
		products,
		orders,
		payments,
		telegramUpdates: createTelegramUpdateService(deps, payments),
		apiKeys: createApiKeyService(deps),
		settings: createSettingsService(deps),
		overview: createOverviewService(deps),
		idempotency: createIdempotencyService(deps),
	};
}

export type Services = ReturnType<typeof createServices>;

export {
	type Actor,
	type CoreConfig,
	createDeps,
	type Deps,
	type Scope,
} from "./deps";
export { DomainError } from "./errors";
export type { ApiKeyPrincipal } from "./services/api-keys";
export type { TelegramWebhookResult } from "./services/telegram-updates";
