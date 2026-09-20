import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import {
	type DashboardContract,
	MODE_HEADER,
	type Mode,
} from "@starpay/contracts";
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { ENV } from "../env";

// Queries render their own error states; failed mutations get a toast.
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: 1, refetchOnWindowFocus: false },
	},
	mutationCache: new MutationCache({
		onError: (error) => {
			toast.error(error.message);
		},
	}),
});

// ── Live / Test mode ──
// Stored per browser and sent with every RPC call as a header.

const MODE_STORAGE_KEY = "starpay-mode";
const modeListeners = new Set<() => void>();

function readMode(): Mode {
	try {
		return localStorage.getItem(MODE_STORAGE_KEY) === "test" ? "test" : "live";
	} catch {
		return "live";
	}
}

let currentMode: Mode = readMode();

export function getMode(): Mode {
	return currentMode;
}

export function setMode(mode: Mode) {
	if (mode === currentMode) return;
	currentMode = mode;
	try {
		localStorage.setItem(MODE_STORAGE_KEY, mode);
	} catch {
		// Storage unavailable (private window): the choice lasts until reload.
	}
	for (const listener of modeListeners) listener();
	// Every query is mode-scoped; drop cached data from the other mode.
	queryClient.resetQueries();
}

export function useMode(): Mode {
	return useSyncExternalStore((listener) => {
		modeListeners.add(listener);
		return () => modeListeners.delete(listener);
	}, getMode);
}

export const link = new RPCLink({
	url: `${ENV.VITE_SERVER_URL.replace(/\/$/, "")}/rpc`,
	headers: () => ({ [MODE_HEADER]: getMode() }),
	fetch(url, options) {
		return fetch(url, {
			...options,
			credentials: "include",
		});
	},
});

export type DashboardClient = ContractRouterClient<DashboardContract>;

export const client: DashboardClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
