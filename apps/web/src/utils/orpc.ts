import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { ContractRouterClient } from "@orpc/contract";
import { type DashboardContract, MODE_HEADER, type Mode } from "@starpay/contracts";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ENV } from "../env";

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        toast.error(`Error: ${error.message}`, {
          action: {
            label: "retry",
            onClick: () => {
              query.invalidate();
            },
          },
        });
      },
    }),
  });
}

export const queryClient = createQueryClient();

const MODE_STORAGE_KEY = "starpay-mode";

/** Live/Test toggle. Stored per browser; every RPC call sends it as a header. */
export function getMode(): Mode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === "test" ? "test" : "live";
  } catch {
    return "live";
  }
}

export function setMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Storage unavailable (private mode); the toggle resets on reload.
  }
  queryClient.invalidateQueries();
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
