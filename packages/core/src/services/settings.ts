import type { SettingsView } from "@starpay/contracts";

import type { Actor, Deps, Scope } from "../deps";
import { serializeSettings } from "../serializers";
import { audit } from "./audit";

export function createSettingsService(deps: Deps) {
	const { db } = deps;

	return {
		async get(scope: Scope) {
			const settings = await db.merchantSettings.upsert({
				where: { organizationId: scope.organizationId },
				create: { organizationId: scope.organizationId },
				update: {},
			});
			return serializeSettings(settings);
		},

		async update(scope: Scope, input: Partial<SettingsView>, actor: Actor) {
			const data = {
				paySupportText: input.pay_support_text,
				notifyPayment: input.notify_payment,
				notifyWebhookFail: input.notify_webhook_fail,
				notifySubCancel: input.notify_sub_cancel,
				notifyDigest: input.notify_digest,
				timezone: input.timezone,
			};
			const settings = await db.merchantSettings.upsert({
				where: { organizationId: scope.organizationId },
				create: { organizationId: scope.organizationId, ...data },
				update: data,
			});
			await audit(
				db,
				scope,
				actor,
				"settings.update",
				scope.organizationId,
				input,
			);
			return serializeSettings(settings);
		},
	};
}
