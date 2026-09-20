# StarPay

**Accept Telegram Stars from any app, website or game — with a REST API, signed webhooks and a merchant dashboard.**

Telegram's Bot API can take Stars payments, but building a product on it means handling invoices, pre-checkout deadlines, duplicate updates, refunds, subscriptions and payouts yourself. StarPay does that part, so your server only has to call one endpoint and listen for a webhook.

```
Your app ──POST /v1/orders──► StarPay ──createInvoiceLink──► Telegram Bot
                                                                  │
                                                        user pays Stars
                                                                  │
Your server ◄──signed webhook── StarPay ◄──successful_payment─────┘
```

> [!WARNING]
> **Alpha, and not audited.** It handles real money and has not been through a security review. In hosted mode StarPay holds funds on behalf of merchants, which is regulated in most countries — read [Hosted mode](#hosted-mode) before pointing it at anything that matters. Nothing here is legal advice.

## What you get

- **REST API** for orders, products, subscriptions, customers and balances, with an OpenAPI spec and docs at `/v1/docs`
- **Reliable payment handling** — pre-checkout answered inside Telegram's 10-second window, one payment recorded per charge no matter how often Telegram redelivers, and payments that arrive after an order expired are still kept
- **Signed webhooks** with retries and a complete delivery trail: the exact request and the exact response for every attempt
- **Refunds and subscriptions**, including refunds Telegram reports on its own
- **Live and Test modes** side by side, Test using Telegram's test environment
- **Dashboard**: revenue, payments with a per-order timeline, products, customers, subscriptions, bot health, API keys, webhooks and settings
- **Two settlement models**: merchants keep their own bot (no custody, no fee), or sell through a shared platform bot with a double-entry ledger, commission and TON payouts

## Quick start

Requirements: **Node 24** (`nvm use`), **pnpm**, **Docker**.

```bash
git clone https://github.com/kichuu/starpay.git
cd starpay
pnpm install
docker compose up -d          # Postgres 17 on localhost:5433
```

Add these to `apps/server/.env` alongside the generated Better-Auth values. Generate the key with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`:

```bash
DATABASE_URL=postgresql://starpay:starpay@localhost:5433/starpay
ENCRYPTION_KEY=<32 random bytes, base64>
PUBLIC_API_URL=http://localhost:3000
```

Then:

```bash
pnpm run db:migrate
pnpm run db:seed              # optional: demo merchant with 30 days of activity
pnpm run dev
```

- Dashboard → http://localhost:3001 (seeded login: `demo@starpay.dev` / `starpay-demo`, switch the sidebar to **Test**)
- API → http://localhost:3000, docs at `/v1/docs`

Telegram only delivers bot updates over HTTPS, so to take a real payment locally, expose port 3000 through a tunnel (cloudflared, ngrok), set `PUBLIC_API_URL` to that URL, and connect a bot from Telegram's test environment.

## Taking a payment

Connect a bot on **Bot & API** (create it with [@BotFather](https://t.me/BotFather) — use a bot dedicated to payments, since StarPay takes over its updates), add a product, create an API key, then:

```bash
curl -X POST https://your-api/v1/orders \
  -H "Authorization: Bearer live_sk_…" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "product": "gems_500",
    "telegram_user_id": 6142883901,
    "reference": "order-3391"
  }'
```

```json
{ "id": "ord_01M2…", "status": "created", "amount": 100, "currency": "XTR",
  "invoice_link": "https://t.me/$AbC…", "expires_at": "…" }
```

Send the buyer to `invoice_link` (or `Telegram.WebApp.openInvoice(...)` in a Mini App). When they pay, your webhook fires.

## Webhooks

Add an endpoint on the **Webhooks** page. Events: `payment.succeeded`, `payment.refunded`, `payment.failed`, `order.expired`, `subscription.renewed`, `subscription.cancelled`, `subscription.expired`.

Each delivery is retried up to five times over about eight hours, and the dashboard keeps every attempt's request and response. Verify the signature before trusting a payload:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

// body must be the RAW request body, not a re-serialised object.
export function verify(body, header, secret) {
  const timestamp = header.match(/t=(\d+)/)?.[1];
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  // During a secret rotation the header carries a v1= for each valid secret.
  return [...header.matchAll(/v1=([a-f0-9]{64})/g)].some(([, signature]) =>
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected)),
  );
}
```

Answer 2xx quickly and do the work afterwards; anything else (including a redirect) is treated as a failure and retried. Use `X-StarPay-Event-Id` to ignore duplicates.

## Hosted mode

A merchant with their own bot keeps the Stars in their own Telegram balance: StarPay never touches the money and charges nothing.

A merchant **without** a bot can sell through StarPay's platform bot instead. Then StarPay holds the money and owes it to them, so it is tracked in a double-entry ledger: every transaction sums to zero, entries are append-only (both enforced by database triggers), and balances are always computed from the entries — there is no stored balance to drift.

- **Fees** are per plan: a percentage plus a flat amount per payment; payouts cost a percentage, a flat amount and the TON network gas, all taken out of the amount withdrawn.
- **Hold and reserve** mirror Fragment's own rules: earnings are released after 21 days, with a rolling reserve held back against refunds.
- **Payouts** go to the merchant's TON wallet. Manual by default, processed from the admin; configure a hot wallet and they send automatically, with the wallet's seqno reserved before sending so a crash can't pay twice.

Before using this for other people's money: Telegram can withhold or debit the platform bot's balance (Bot Developer Terms §6.2.4), which affects every hosted merchant at once, and holding customer funds is regulated. `docs/PLAN.md` §13 has the full design and the risks.

## How it works

```
apps/
  server/      Hono: /rpc (dashboard), /v1 (public API), /telegram/webhook/:botId, worker jobs
  web/         React + TanStack Router dashboard (also runs as a Telegram Mini App)
packages/
  contracts/   Zod schemas + oRPC contracts — the single source of truth for every API shape
  api/         Controllers: auth, role and mode checks, then a call into core
  core/        Business logic: orders, payments, bots, ledger, payouts, webhooks
  telegram/    Typed Telegram Bot API client, with test-environment support
  auth/        Better-Auth (organizations = merchants, roles owner/developer/support)
  db/          Prisma schema, migrations and client
  ui/          Shared components
  infra/       Alchemy deployment
```

Design decisions worth knowing, all covered in [`docs/PLAN.md`](docs/PLAN.md):

- The order ID **is** the Telegram invoice payload, so payment updates need no lookup table.
- Pre-checkout is answered in the webhook's own HTTP response — one fewer round trip inside a 10-second limit.
- Webhook events are written in the same transaction as the state change (outbox), so an event exists if and only if the change committed.
- Bot tokens and webhook secrets are encrypted with `ENCRYPTION_KEY`; API keys are stored only as hashes.

## Testing

```bash
docker exec starpay-postgres psql -U starpay -c "CREATE DATABASE starpay_test"   # once
pnpm -F @starpay/core test
```

37 tests run against a real Postgres, with Telegram faked and a real local HTTP server for webhooks: the payment flow, duplicate handling, refunds, the ledger (including concurrent payout double-spend), and webhook signing, retries and the delivery trail.

## Deployment

`packages/infra` deploys the API, dashboard and database to [Prisma](https://www.prisma.io/) with [Alchemy](https://alchemy.run). It isn't the only way to run StarPay — it's a Node server, a static site and Postgres — but it's the path that's wired up:

```bash
pnpm run deploy        # preview with: pnpm -F @starpay/infra plan
```

Deploys run with `NODE_ENV=production` and read two gitignored files:

- `apps/server/.env.production` — `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (never the development ones), `BETTER_AUTH_URL` and `PUBLIC_API_URL` (the API's address), `CORS_ORIGIN` (the dashboard's), and optionally `PLATFORM_ADMIN_USER_IDS` and a TON payout mnemonic
- `apps/web/.env.production` — `VITE_SERVER_URL`

Alchemy needs a Prisma service token and an `ALCHEMY_PASSWORD` in `packages/infra/.env`. On a fresh stack, deploy once to learn the two URLs, put them in those files, and deploy again. Migrations are applied as part of the deploy.

Keep `ENCRYPTION_KEY` safe: it decrypts every stored bot token, so losing it means every merchant has to reconnect their bot.

## Scripts

| Command | What it does |
|---|---|
| `pnpm run dev` | Dashboard + API against the local database |
| `pnpm run db:migrate` | Create and apply migrations |
| `pnpm run db:seed` | Demo merchant with ~30 days of activity |
| `pnpm run db:studio` | Prisma Studio |
| `pnpm run check-types` | Type-check every package |
| `pnpm run check` | Biome lint and format |
| `pnpm -F server ton-wallet` | Generate a TON hot wallet for payouts |

## Not done yet

- Merchants and the API live on separate domains in the reference deployment, so the session cookie is third-party — **Safari blocks it**. Custom domains sharing a parent (`app.` / `api.`) fix it.
- No rate limiting on the public API.
- Team invitations and notification emails are not wired to an email provider.
- Automatic TON payouts have been tested against a fake wallet only; try testnet before mainnet.
- No per-customer credit balances (useful for games priced below Telegram's 50-Star minimum purchase).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

Not affiliated with Telegram. "Telegram" and "Telegram Stars" are trademarks of Telegram FZ-LLC.
