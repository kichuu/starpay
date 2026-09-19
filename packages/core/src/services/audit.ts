import type { Tx } from "@starpay/db";

import type { Actor, Scope } from "../deps";
import { toJson } from "../serializers";

export async function audit(
	tx: Tx,
	scope: Scope,
	actor: Actor,
	action: string,
	targetId?: string,
	data: Record<string, unknown> = {},
): Promise<void> {
	await tx.auditLog.create({
		data: {
			organizationId: scope.organizationId,
			mode: scope.mode,
			actorType: actor.type,
			actorId: actor.id,
			action,
			targetId,
			data: toJson(data),
		},
	});
}
