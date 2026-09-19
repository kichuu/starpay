import type { DashboardContext, PublicContext } from "@starpay/api";
import type { Context as HonoContext } from "hono";

import { auth, db, services } from "./services";

export async function createDashboardContext(
	c: HonoContext,
): Promise<DashboardContext> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	return { db, services, session, headers: c.req.raw.headers };
}

export function createPublicContext(c: HonoContext): PublicContext {
	return { services, headers: c.req.raw.headers };
}
