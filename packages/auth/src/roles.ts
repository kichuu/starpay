import { createAccessControl } from "better-auth/plugins/access";
import {
	defaultStatements,
	memberAc,
	ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Team roles. Better-Auth enforces team management (invites, role changes);
 * StarPay's own permissions are enforced in @starpay/api via ROLE_RANK.
 */
export const ac = createAccessControl(defaultStatements);

export const roles = {
	owner: ac.newRole(ownerAc.statements),
	developer: ac.newRole(memberAc.statements),
	support: ac.newRole(memberAc.statements),
};

export type MemberRole = keyof typeof roles;

export const ROLE_RANK: Record<MemberRole, number> = {
	support: 1,
	developer: 2,
	owner: 3,
};
