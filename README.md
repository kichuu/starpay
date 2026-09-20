# starpay

StarPay is a payment backend for selling digital goods for Telegram Stars. A merchant connects their own bot; StarPay creates invoices, handles Telegram's payment updates and sends signed webhooks to the merchant's server. It never holds funds. See [docs/PLAN.md](docs/PLAN.md) for the architecture.

Built on [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack): React, TanStack Router, Hono, oRPC, Prisma and Better-Auth.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Router** - File-based routing with full type safety
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **Node.js** - Runtime environment
- **Prisma** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Biome** - Linting and formatting
- **Turborepo** - Optimized monorepo build system

## Getting Started

Requirements: Node.js 24 (`nvm use` reads `.nvmrc`), pnpm and Docker.

```bash
pnpm install
docker compose up -d          # Postgres 17 on localhost:5433
```

Add these to `apps/server/.env` (next to the Better-Auth values). Generate `ENCRYPTION_KEY` with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and paste the output:

```bash
DATABASE_URL=postgresql://starpay:starpay@localhost:5433/starpay
ENCRYPTION_KEY=<32 random bytes, base64>
PUBLIC_API_URL=http://localhost:3000
```

`PUBLIC_API_URL` must be a public HTTPS URL before Telegram can deliver bot updates (see below).

Apply migrations and start the web app and API against the local database:

```bash
pnpm run db:migrate
pnpm run dev            # or: pnpm dev:web / pnpm dev:server
```

`pnpm dev:alchemy` runs the Alchemy dev stack instead, which provisions a cloud Prisma Postgres.

### Demo data

```bash
pnpm db:seed
```

Creates `demo@starpay.dev` / `starpay-demo` with a "Pixel Forge" merchant in **Test mode** (switch the sidebar toggle to Test): products, customers and about 30 days of orders, payments and refunds. Its bot is a stub, so anything that calls Telegram live (refunds, balance, transactions) returns a Telegram error for this merchant.

- Dashboard: http://localhost:3001
- API: http://localhost:3000 (dashboard RPC at `/rpc`, public API at `/v1`, docs at `/v1/docs`)

Telegram only delivers bot updates over HTTPS. To test real payments locally, expose port 3000 through a tunnel (cloudflared, ngrok), set `PUBLIC_API_URL` to the tunnel URL, and connect a bot from Telegram's test environment.

### Tests

```bash
docker exec starpay-postgres psql -U starpay -c "CREATE DATABASE starpay_test"   # once
pnpm -F @starpay/core test
```

The tests run the payment flow against the `starpay_test` database with a fake Telegram client.

## Hosted mode (StarPay's own bot)

Merchants without their own bot sell through StarPay's **platform bot**: StarPay holds the Stars, tracks what each merchant is owed in a double-entry ledger, takes a commission and pays them out in TON. Merchants who connect their own bot are unaffected — no custody, no fee.

To run it:

1. Put your user ID in `PLATFORM_ADMIN_USER_IDS` (Settings → "Your user ID" shows it) and restart the server. A **Platform admin** link appears in the sidebar.
2. In **Platform admin → Overview**, connect the platform bot for Live and/or Test with a token from @BotFather.
3. Adjust the commercial terms in **Fee plans** (default: 5%, 21-day hold, 10% reserve over 30 days, 1,000-Star minimum payout), and assign plans per merchant under **Merchants**.
4. Merchants add a TON wallet in Settings and request payouts from Balance.
5. Payouts are processed **by hand** by default: the queue is in **Platform admin → Payouts**, where you mark each one paid (with the TON transaction) or failed. Set `TON_PAYOUT_MNEMONIC_LIVE` / `TON_PAYOUT_MNEMONIC_TEST` (24 words, a dedicated V4R2 wallet used for nothing else) to send automatically instead.
6. After withdrawing the platform bot's Stars on Fragment, record it in **Platform admin** so the books move the Stars into the TON treasury.

Before this takes real money: Telegram may withhold or debit the platform bot's balance (Developer Terms §6.2.4), which affects every hosted merchant at once, and holding other people's funds is regulated in most countries. See `docs/PLAN.md` §13.

## Database Setup

Generate the Prisma client before development, typechecking, or building, including in CI and deployment builds. Run this again after changing the Prisma schema:

```bash
pnpm run db:generate
```

Alchemy provisions Prisma Postgres, passes its connection credentials directly to the deployed application, and manages database deployment in the same stack as the consuming app. You do not need to copy a hosted `DATABASE_URL` into the app environment.

Create and commit migrations with `pnpm run db:migrate`; deployment applies checked-in migrations with `prisma migrate deploy`.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@starpay/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `pnpm run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Deployment

Alchemy deploys the API and the dashboard to Prisma Compute and the database to Prisma Postgres (`packages/infra/alchemy.run.ts`). The live stage is `prod`.

**Once per machine**

1. Create a service token in the Prisma Console (workspace → Settings → Service tokens) and put it in `packages/infra/.env` as `PRISMA_SERVICE_TOKEN=…`, together with an `ALCHEMY_PASSWORD` (any long random string; it encrypts secrets in the local Alchemy state).
2. Production settings live in two gitignored files, loaded because deploys run with `NODE_ENV=production`:
   - `apps/server/.env.production`: `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (never reuse the local ones), `BETTER_AUTH_URL` and `PUBLIC_API_URL` (the server URL), `CORS_ORIGIN` (the web URL)
   - `apps/web/.env.production`: `VITE_SERVER_URL` (the server URL)
3. Bun must be on your PATH: Alchemy bundles the server with `bun build`.

**Deploy**

```bash
pnpm run deploy        # plan: pnpm -F @starpay/infra plan
```

Migrations in `packages/db/prisma/migrations` are applied to Prisma Postgres during the deploy. On a brand-new stack, deploy once to get the server and web URLs, fill them into the two `.env.production` files, and deploy again.

Keep `ENCRYPTION_KEY` safe: it decrypts every stored bot token and webhook secret, so losing or changing it means reconnecting every bot.

## Git Hooks and Formatting

- Run checks: `pnpm run check`

## Project Structure

```
starpay/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Router)
│   └── server/      # Backend API (Hono, ORPC)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── contracts/   # Zod schemas + oRPC contracts (public API, dashboard, webhooks)
│   ├── api/         # Controllers: auth/role/mode middleware → core services
│   ├── core/        # Business logic (orders, payments, bots, API keys, …)
│   ├── telegram/    # Typed Telegram Bot API client
│   ├── auth/        # Better-Auth config (organizations = merchants)
│   └── db/          # Prisma schema, migrations & client
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run dev:server`: Start only the server
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run db:push`: Push schema changes to database
- `pnpm run db:generate`: Generate database client/types
- `pnpm run db:migrate`: Run database migrations
- `pnpm run db:studio`: Open database studio UI
- `pnpm run check`: Run Biome formatting and linting

## Better Auth Schema Generation

After changing auth plugins or schema options, run `pnpm run auth:generate` from the project root. The script runs the Better Auth CLI through `varlock run` from the owning app directory, loading the auth instance from `src/services.ts`. Review the schema changes, then use your ORM's migration workflow to apply them.
