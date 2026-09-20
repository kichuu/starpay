# Contributing

Thanks for taking a look. Issues and pull requests are both welcome.

## Getting set up

See [Quick start](README.md#quick-start). In short: Node 24, pnpm, Docker, then

```bash
pnpm install && docker compose up -d && pnpm run db:migrate && pnpm run dev
```

## Before opening a pull request

```bash
pnpm run check-types     # types across every package
pnpm run check           # Biome lint + format
pnpm -F @starpay/core test
```

The tests need the `starpay_test` database:

```bash
docker exec starpay-postgres psql -U starpay -c "CREATE DATABASE starpay_test"
```

## How the code is organised

Changes usually move through the same layers, in this order:

1. **`packages/contracts`** — the Zod schema and oRPC contract. Every API shape lives here, and both the server and the dashboard import it.
2. **`packages/core`** — the business logic, as a service that takes its dependencies (`db`, `telegram`, `now`, wallet, rates) as an argument so it can be tested with fakes.
3. **`packages/api`** — a thin controller: check auth, role and mode, then call core.
4. **`apps/web`** — the screen.

A few conventions that keep the money side honest:

- **Money is whole Stars** (`Int`). Balances are always summed from ledger entries; never add a stored balance column.
- **Anything Telegram can send twice must be idempotent.** Payments are keyed on the charge ID, ledger postings on an idempotency key.
- **State changes and their events go in one transaction**, so an event can't exist for a change that rolled back.
- Reach for `deps.now()` rather than `new Date()`, so tests can move time.

## Tests

Tests run against a real Postgres, a fake Telegram client, and (for webhooks) a real local HTTP server. If you're changing anything that touches money, add a case that covers the failure, not just the happy path — the existing suite has examples for duplicate payments, refunds after payout, and concurrent payout requests.

## Style

Biome handles formatting and linting; run `pnpm run check` and follow what it says. Match the surrounding code, and write comments that explain *why* something is done, not what the next line does.
