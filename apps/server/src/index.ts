import { serve } from "@hono/node-server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { dashboardRouter, publicRouter } from "@starpay/api";
import { MODE_HEADER } from "@starpay/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createDashboardContext, createPublicContext } from "./context";
import { ENV } from "./env.server";
import { auth, services } from "./services";
import { telegramRoutes } from "./telegram/route";
import { startWorker } from "./worker";

/** Logs procedure errors except expected ones (ORPCErrors with a 4xx status). */
function logUnexpected(error: unknown) {
	const status = (error as { status?: number }).status;
	if (status === undefined || status >= 500) console.error(error);
}

const app = new Hono();

app.use(logger());

// Browser-facing routes only. /v1 is called server-to-server and /telegram by Telegram.
const dashboardCors = cors({
	origin: ENV.CORS_ORIGIN,
	allowMethods: ["GET", "POST", "OPTIONS"],
	allowHeaders: ["Content-Type", "Authorization", MODE_HEADER],
	credentials: true,
});
app.use("/api/auth/*", dashboardCors);
app.use("/rpc/*", dashboardCors);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

const rpcHandler = new RPCHandler(dashboardRouter, {
	clientInterceptors: [onError(logUnexpected)],
});
app.use("/rpc/*", async (c, next) => {
	const { matched, response } = await rpcHandler.handle(c.req.raw, {
		prefix: "/rpc",
		context: await createDashboardContext(c),
	});
	return matched ? c.newResponse(response.body, response) : next();
});

const publicHandler = new OpenAPIHandler(publicRouter, {
	clientInterceptors: [onError(logUnexpected)],
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
			docsPath: "/docs",
			specPath: "/openapi.json",
			docsTitle: "StarPay API",
			specGenerateOptions: {
				info: { title: "StarPay API", version: "1.0.0" },
				servers: [{ url: `${ENV.PUBLIC_API_URL.replace(/\/$/, "")}/v1` }],
				security: [{ apiKey: [] }],
				components: {
					securitySchemes: {
						apiKey: {
							type: "http",
							scheme: "bearer",
							description: "live_sk_… or test_sk_…",
						},
					},
				},
			},
		}),
	],
});
app.use("/v1/*", async (c, next) => {
	const { matched, response } = await publicHandler.handle(c.req.raw, {
		prefix: "/v1",
		context: createPublicContext(c),
	});
	return matched ? c.newResponse(response.body, response) : next();
});

app.route("/telegram", telegramRoutes);

app.get("/", (c) => c.text("OK"));

serve({ fetch: app.fetch, port: 3000 }, (info) => {
	console.log(`Server is running on http://localhost:${info.port}`);
});

if (ENV.WORKER_ENABLED) {
	const stopWorker = startWorker(services);
	process.once("SIGTERM", stopWorker);
}
