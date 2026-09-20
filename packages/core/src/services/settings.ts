import type { SettingsView } from "@starpay/contracts";

import type { Actor, Deps, Scope } from "../deps";
import { errors } from "../errors";
import { serializeSettings } from "../serializers";
import { isValidTonAddress } from "../ton";
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
			const address = input.payout_ton_address?.trim();
			if (address && !isValidTonAddress(address)) {
				throw errors.badRequest(
					"That isn't a valid TON wallet address",
					"payout_ton_address",
				);
			}
			const data = {
				payoutTonAddress:
					input.payout_ton_address === undefined ? undefined : address || null,
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
