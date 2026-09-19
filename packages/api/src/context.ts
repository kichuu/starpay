import type { Session } from "@starpay/auth";
import type { Services } from "@starpay/core";
import type { Database } from "@starpay/db";

/** Built per request by the server for /rpc (dashboard). */
export type DashboardContext = {
	db: Database;
	services: Services;
	session: Session | null;
	headers: Headers;
};

/** Built per request by the server for /v1 (public API). */
export type PublicContext = {
	services: Services;
	headers: Headers;
};
