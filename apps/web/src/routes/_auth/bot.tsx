import type { BotView } from "@starpay/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
  Avatar,
  Button,
  CopyButton,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  GridRow,
  inputClass,
  Mono,
  Panel,
  PanelHeader,
  Pill,
  RowsSkeleton,
} from "@/components/kit";
import { ENV } from "@/env";
import { initials, timeAgo } from "@/lib/format";
import { orpc, useMode } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/bot")({
  component: BotAndApi,
  staticData: { title: "Bot & API", subtitle: "Credentials and integration" },
});

const API_URL = ENV.VITE_SERVER_URL.replace(/\/$/, "");

function BotAndApi() {
  return (
    <>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <BotPanel />
        <SnippetPanel />
      </div>
      <ApiKeysPanel />
    </>
  );
}

// ── Bot ──

function BotPanel() {
  const queryClient = useQueryClient();
  const bot = useQuery(orpc.bot.get.queryOptions());
  const [replacing, setReplacing] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: orpc.bot.key() });
    queryClient.invalidateQueries({ queryKey: orpc.onboarding.key() });
  };
  const refresh = useMutation(
    orpc.bot.refresh.mutationOptions({
      onSuccess: (view) => {
        queryClient.setQueryData(orpc.bot.get.queryKey(), view);
        toast.success(view.status === "active" ? "Bot is healthy" : "Status updated");
      },
    }),
  );
  const disconnect = useMutation(
    orpc.bot.disconnect.mutationOptions({
      onSuccess: () => {
        toast.success("Bot disconnected");
        setConfirmDisconnect(false);
        refreshAll();
      },
    }),
  );

  if (bot.isPending) {
    return (
      <Panel>
        <RowsSkeleton rows={4} />
      </Panel>
    );
  }
  if (bot.isError) {
    return (
      <Panel>
        <ErrorState error={bot.error} onRetry={() => bot.refetch()} />
      </Panel>
    );
  }
  if (!bot.data) {
    return (
      <Panel className="p-5">
        <h2 className="text-[14.5px] font-bold">Connect your bot</h2>
        <ConnectBotForm onConnected={refreshAll} />
      </Panel>
    );
  }

  const view = bot.data;
  const rows = [
    {
      label: "Bot token",
      value: view.status === "invalid_token" ? "Rejected by Telegram" : `Valid · ends ${view.token_last4}`,
      ok: view.status !== "invalid_token",
    },
    {
      label: "Telegram webhook",
      value:
        view.status === "active"
          ? `Set · ${view.pending_updates} pending update${view.pending_updates === 1 ? "" : "s"}`
          : (view.last_webhook_error ?? "Not reachable"),
      ok: view.status === "active",
    },
    { label: "Last update", value: timeAgo(view.last_update_at), ok: true },
    { label: "Payments provider", value: "Telegram Stars (XTR)", ok: true },
  ];

  return (
    <Panel className="flex flex-col p-5">
      <h2 className="mb-4 text-[14.5px] font-bold">Connected bot</h2>
      <div className="mb-4 flex items-center gap-3">
        <Avatar text={initials(view.first_name)} className="size-11 text-[14px]" />
        <div className="min-w-0">
          <a
            href={`https://t.me/${view.username}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[15px] font-bold hover:underline"
          >
            @{view.username} <ExternalLink className="size-3.5 text-faint" />
          </a>
          <div className="text-[12.5px] text-muted-foreground">
            {view.first_name} · id <Mono>{view.telegram_bot_id}</Mono>
          </div>
        </div>
      </div>
      <dl className="flex flex-col">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4 border-t border-border/60 py-2.5 text-[13px]">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd
              className={
                row.ok ? "text-right font-semibold" : "text-right font-semibold text-[#B42318] dark:text-[#f97066]"
              }
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {view.status === "webhook_error" && view.last_webhook_error?.includes("HTTPS") && (
        <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground">
          Telegram only delivers updates to public HTTPS URLs. Locally, run a tunnel to the API and set
          PUBLIC_API_URL to it, then press Refresh.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" loading={refresh.isPending} onClick={() => refresh.mutate({})}>
          Refresh status
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setReplacing(true)}>
          Replace token
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setConfirmDisconnect(true)}>
          Disconnect
        </Button>
      </div>

      <Dialog open={replacing} onOpenChange={setReplacing} title="Replace bot token" description="Paste a new token from @BotFather, for this bot or a different one.">
        <ConnectBotForm
          onConnected={() => {
            setReplacing(false);
            refreshAll();
          }}
        />
      </Dialog>
      <Dialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={`Disconnect @${view.username}?`}
        description="StarPay stops receiving its updates, so new payments won't be recorded and orders can't be created until you reconnect."
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDisconnect(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate({})}>
            Disconnect bot
          </Button>
        </div>
      </Dialog>
    </Panel>
  );
}

function ConnectBotForm({ onConnected }: { onConnected: (view: BotView) => void }) {
  const mode = useMode();
  const [token, setToken] = useState("");
  const connect = useMutation(
    orpc.bot.connect.mutationOptions({
      onSuccess: (view) => {
        toast.success(`Connected @${view.username}`);
        setToken("");
        onConnected(view);
      },
    }),
  );

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    connect.mutate({ token: token.trim() });
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-muted-foreground">
        {mode === "test" ? (
          <li>
            Open <strong>@BotFather on Telegram's test server</strong> (a separate test account) and create a bot.
            Test mode only works with test-server bots.
          </li>
        ) : (
          <li>
            Open{" "}
            <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">
              @BotFather
            </a>{" "}
            and create a bot just for payments.
          </li>
        )}
        <li>Copy the token it gives you and paste it below.</li>
        <li>StarPay takes over the bot's updates. Don't use this bot for anything else.</li>
      </ol>
      <Field label="Bot token" htmlFor="bot-token" hint="Stored encrypted. Only the last 4 characters are ever shown.">
        <input
          id="bot-token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="7412889301:AAH…"
          autoComplete="off"
          spellCheck={false}
          required
          className={`${inputClass} font-mono`}
        />
      </Field>
      <Button type="submit" loading={connect.isPending} disabled={!token.trim()} className="self-start">
        Connect bot
      </Button>
    </form>
  );
}

// ── Integration snippet ──

function SnippetPanel() {
  const mode = useMode();
  const snippet = `const res = await fetch("${API_URL}/v1/orders", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${mode}_sk_…",
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
  },
  body: JSON.stringify({
    product: "gems_500",           // ID or lookup key
    telegram_user_id: 6142883901,  // optional: only they can pay
    reference: "order-3391",       // your own ID
  }),
});

const { id, invoice_link } = await res.json();
// Send the buyer to invoice_link, or call
// Telegram.WebApp.openInvoice(invoice_link) in a Mini App.`;

  return (
    <Panel className="flex flex-col">
      <PanelHeader
        title="Create an order"
        action={
          <div className="flex items-center gap-1">
            <CopyButton value={snippet} />
            <a
              href={`${API_URL}/v1/docs`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-semibold text-brand hover:bg-muted"
            >
              API docs <ExternalLink className="size-3.5" />
            </a>
          </div>
        }
      />
      <pre className="flex-1 overflow-x-auto bg-[#0B1B2B] p-5 font-mono text-[12.5px] leading-relaxed text-[#CFE0FF]">
        {snippet}
      </pre>
    </Panel>
  );
}

// ── API keys ──

const KEY_COLUMNS = "minmax(200px,1.5fr) 80px 130px 90px";

function ApiKeysPanel() {
  const mode = useMode();
  const queryClient = useQueryClient();
  const keys = useQuery(orpc.apiKeys.list.queryOptions());
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; secret: string } | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: orpc.apiKeys.key() });
    queryClient.invalidateQueries({ queryKey: orpc.onboarding.key() });
  };
  const create = useMutation(
    orpc.apiKeys.create.mutationOptions({
      onSuccess: (key) => {
        setCreating(false);
        setCreated({ name: key.name, secret: key.secret });
        invalidate();
      },
    }),
  );
  const revoke = useMutation(
    orpc.apiKeys.revoke.mutationOptions({
      onSuccess: () => {
        toast.success("Key revoked");
        setRevoking(null);
        invalidate();
      },
    }),
  );

  const active = keys.data?.filter((key) => !key.revoked_at) ?? [];

  return (
    <Panel>
      <PanelHeader
        title="API keys"
        description={`${mode === "live" ? "Live" : "Test"} keys. They only see ${mode} data.`}
        action={<Button onClick={() => setCreating(true)}>Create key</Button>}
      />
      <div className="overflow-x-auto">
        <div role="table" aria-label="API keys" className="min-w-[560px]">
          {keys.isPending ? (
            <RowsSkeleton rows={3} />
          ) : keys.isError ? (
            <ErrorState error={keys.error} onRetry={() => keys.refetch()} />
          ) : active.length === 0 ? (
            <EmptyState icon={<KeyRound />} title={`No ${mode} keys`}>
              Your server uses a secret key to create orders. Keep it on the server, never in an app or website.
            </EmptyState>
          ) : (
            active.map((key) => (
              <GridRow key={key.id} columns={KEY_COLUMNS}>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{key.name}</div>
                  <Mono className="text-muted-foreground">{key.masked}</Mono>
                </div>
                <div>
                  <Pill tone={key.mode === "live" ? "success" : "neutral"}>{key.mode === "live" ? "Live" : "Test"}</Pill>
                </div>
                <div className="text-[12.5px] text-muted-foreground">
                  {key.last_used_at ? `used ${timeAgo(key.last_used_at)}` : "never used"}
                </div>
                <div className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setRevoking({ id: key.id, name: key.name })}>
                    Revoke
                  </Button>
                </div>
              </GridRow>
            ))
          )}
        </div>
      </div>

      <Dialog open={creating} onOpenChange={setCreating} title="Create API key" description={`A ${mode} secret key for your server.`}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
            if (name) create.mutate({ name });
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Name" htmlFor="key-name" hint="Where it's used, e.g. Production server">
            <input id="key-name" name="name" required maxLength={64} autoFocus className={inputClass} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create key
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={created !== null}
        onOpenChange={(open) => !open && setCreated(null)}
        title={`${created?.name ?? ""} key created`}
        description="Copy it now. For your security, StarPay won't show it again."
      >
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3.5 py-3">
          <Mono className="min-w-0 flex-1 break-all">{created?.secret}</Mono>
          {created && <CopyButton value={created.secret} />}
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => setCreated(null)}>Done</Button>
        </div>
      </Dialog>

      <Dialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke "${revoking?.name}"?`}
        description="Requests using this key will fail immediately. This can't be undone."
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRevoking(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={revoke.isPending}
            onClick={() => revoking && revoke.mutate({ id: revoking.id })}
          >
            Revoke key
          </Button>
        </div>
      </Dialog>
    </Panel>
  );
}
