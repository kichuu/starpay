# StarPay — Backend Architecture Plan

Status: draft v1 · 2026-09-19
Scope: data model, API surfaces and contracts, service / controller / DB layering, background jobs, milestones.
Inputs: the Better-T-Stack scaffold in this repo and `StarPay Dashboard (1).html` (the dashboard design).

---

## 0. Ground rules

- **Two settlement modes.**
  - **Direct (non-custodial):** the merchant connects their own bot. Stars stay in their Telegram balance, StarPay never touches the money and charges no commission. They withdraw on Fragment themselves.
  - **Hosted (custodial):** the merchant has no bot of their own, so StarPay's platform bot takes the payment. The money is StarPay's to hold and owe: a double-entry ledger tracks each merchant's balance, StarPay takes a commission, and merchants are paid out in TON. See §13.
- **Merchant = Better-Auth organization.** Team members and their roles (Owner / Developer / Support) come from the Better-Auth `organization` plugin.
- **Live / Test mode on every row.** Every merchant-owned table has a `mode` column (`live | test`). Test mode uses a *separate* bot token on Telegram's test environment (`https://api.telegram.org/bot<token>/test/<method>`).
- **Stars are integers.** Stars are stored as `Int`. USD values are shown in the UI as estimates only and never stored.
- **Prefixed IDs.** IDs are generated in the app: `ord_`, `prod_`, `sub_`, `pay_`, `evt_`, `we_`, `whd_`, `cus_`, `bot_`, `key_`. They are readable in logs and support tickets, and they are what appears in the design.
- **Idempotency throughout:**
  - Telegram updates are de-duplicated by `(botId, update_id)`.
  - Payments are de-duplicated by `telegram_payment_charge_id`.
  - Public API POSTs accept an `Idempotency-Key` header.
  - Merchant webhooks carry the event ID so the merchant can de-duplicate.

---

## 1. System overview

```
                         ┌──────────────── apps/server (Hono, Prisma Compute) ────────────────┐
Merchant backend ──────► │ /v1/*        Public REST API  (oRPC OpenAPIHandler, API-key auth)  │
Dashboard (web/TMA) ───► │ /rpc/*       Dashboard RPC    (oRPC RPCHandler, session auth)       │
Browser ───────────────► │ /api/auth/*  Better-Auth                                            │
Telegram ──────────────► │ /telegram/webhook/:botId   (plain Hono route, secret-token auth)    │
                         │                                                                     │
                         │ worker (same process): webhook dispatcher, expiry, sync jobs       │
                         └──────────────┬──────────────────────────────────────────────────────┘
                                        │ packages/core (services) → packages/db (repositories)
                                        ▼
                                  Prisma Postgres
```

The server and worker run in **one process** for now. Prisma Compute runs a long-running container (it has a port and a health check), so in-process loops work. All worker queries use `FOR UPDATE SKIP LOCKED` and advisory locks, so running two or more instances stays safe. The worker can be split into its own Compute service later with no code changes, only a different entrypoint.

---

## 2. Monorepo layout (target)

```
apps/
  server/                  Hono app: wiring only
    src/index.ts           mounts auth, /rpc, /v1, /telegram, starts worker
    src/telegram/route.ts  Telegram webhook controller
    src/worker/*.ts        job loops (dispatcher, expiry, sync)
    src/context.ts         builds DashboardContext / PublicApiContext
  web/                     TanStack Router SPA (web + Telegram Mini App)

packages/
  contracts/   NEW  zod schemas + oRPC contracts (oc). No server deps, safe to import in web and a future SDK.
  api/              "controllers": implement(contract) → call core services. Middlewares (auth, org, role, mode, api-key).
  core/        NEW  domain services + domain errors. Pure TS; depends on db, telegram, crypto.
  telegram/    NEW  typed minimal Bot API client (+ test-env support, webhook-reply helpers).
  db/               Prisma schema, client, repositories (complex queries only), id generator.
  auth/             Better-Auth config (+ organization, apiKey?, bearer plugins).
  ui/               shared components.
  infra/            Alchemy.
```

### Layer rules

| Layer | Knows about | Must not |
|---|---|---|
| **contracts** | zod | import prisma, hono, or anything server-side |
| **api (controllers)** | contracts, core, ctx | contain business logic or call Prisma directly |
| **core (services)** | db, telegram, crypto | know about HTTP, oRPC, or Hono |
| **db (repositories)** | Prisma | throw domain errors (they return `null` or rows) |

- Services take an explicit `Deps` object: `{ db, telegram, clock, ids, crypto, config }`. This keeps them testable.
- Services that need a transaction accept `tx` (a Prisma transaction client) as an optional argument.
- Domain errors live in `core/errors.ts`, e.g. `OrderNotFound`, `OrderNotRefundable`, `BotNotConnected`, `ProductArchived`. A single oRPC error interceptor maps them to HTTP codes and the public error format.

---

## 3. Database schema (Prisma)

New file: `packages/db/prisma/schema/starpay.prisma`. The auth and organization tables are generated by `pnpm auth:generate` once the plugins are added.

```prisma
enum Mode { live test }

enum BotStatus { active invalid_token webhook_error disconnected }

enum ProductType   { one_time subscription }
enum ProductStatus { active archived }

enum OrderStatus { created pre_checkout paid refunded expired failed }

enum SubscriptionStatus { active cancelled expired }

enum DeliveryStatus { pending succeeded failed }   // failed = gave up after max attempts

enum EndpointStatus { active disabled }

model MerchantSettings {
  organizationId   String   @id
  paySupportText   String   @default("")
  notifyPayment    Boolean  @default(true)
  notifyWebhookFail Boolean @default(true)
  notifySubCancel  Boolean  @default(true)
  notifyDigest     Boolean  @default(false)
  timezone         String   @default("UTC")
  updatedAt        DateTime @updatedAt
  @@map("merchant_settings")
}

model Bot {
  id               String    @id              // bot_…
  organizationId   String
  mode             Mode
  telegramBotId    BigInt
  username         String
  firstName        String
  tokenEncrypted   String                     // AES-256-GCM, key = ENCRYPTION_KEY
  tokenLast4       String
  webhookSecret    String                     // random 64 chars; compared to X-Telegram-Bot-Api-Secret-Token
  status           BotStatus @default(active)
  lastUpdateAt     DateTime?
  lastUpdateType   String?
  pendingUpdates   Int       @default(0)      // from getWebhookInfo
  lastWebhookError String?
  starBalance      Int?                        // from getMyStarBalance
  balanceSyncedAt  DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@unique([organizationId, mode])            // one bot per merchant per mode
  @@unique([telegramBotId, mode])
  @@map("bot")
}

model ApiKey {
  id             String    @id               // key_…
  organizationId String
  mode           Mode
  name           String
  prefix         String                      // "live_sk_4f2a" shown in UI
  hash           String    @unique           // sha256(fullKey)
  last4          String
  lastUsedAt     DateTime?
  revokedAt      DateTime?
  createdById    String
  createdAt      DateTime  @default(now())

  @@index([organizationId, mode])
  @@map("api_key")
}

model Product {
  id             String        @id           // prod_…
  organizationId String
  mode           Mode
  lookupKey      String?                     // merchant-chosen, e.g. "nebula_skins"
  name           String                      // Telegram invoice title: 1–32 chars
  description    String                      // Telegram invoice description: 1–255 chars
  photoUrl       String?
  priceStars     Int
  type           ProductType
  periodSeconds  Int?                        // 2592000 for subscriptions (Telegram only allows 30 days)
  status         ProductStatus @default(active)
  metadata       Json          @default("{}")
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  orders         Order[]
  @@unique([organizationId, mode, lookupKey])
  @@index([organizationId, mode, status])
  @@map("product")
}

model Customer {
  id             String    @id               // cus_…
  organizationId String
  mode           Mode
  telegramUserId BigInt
  username       String?
  firstName      String?
  lastName       String?
  languageCode   String?
  totalSpent     Int       @default(0)       // denormalised, updated in the payment tx
  orderCount     Int       @default(0)
  lastPaymentAt  DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  orders         Order[]
  @@unique([organizationId, mode, telegramUserId])
  @@index([organizationId, mode, totalSpent(sort: Desc)])
  @@map("customer")
}

model Order {
  id                String      @id          // ord_… (also the Telegram invoice_payload)
  organizationId    String
  mode              Mode
  productId         String
  product           Product     @relation(fields: [productId], references: [id])
  customerId        String?
  customer          Customer?   @relation(fields: [customerId], references: [id])
  payerTelegramId   BigInt?                  // if set, pre-checkout rejects anyone else
  amountStars       Int                      // snapshot of the price
  title             String                   // snapshot
  description       String                   // snapshot
  status            OrderStatus @default(created)
  failureReason     String?                  // e.g. "expired", "payer_mismatch", "product_archived"
  merchantReference String?                  // merchant's own ID ("order-3391" in the design snippet)
  metadata          Json        @default("{}")
  invoiceLink       String?
  expiresAt         DateTime
  paidAt            DateTime?
  refundedAt        DateTime?
  apiKeyId          String?
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt

  payments          Payment[]
  events            OrderEvent[]
  subscription      Subscription?
  @@index([organizationId, mode, createdAt(sort: Desc)])
  @@index([organizationId, mode, status])
  @@index([status, expiresAt])               // expiry job
  @@index([organizationId, mode, merchantReference])
  @@map("order")
}

model Payment {
  id                 String   @id            // pay_…
  organizationId     String
  mode               Mode
  orderId            String
  order              Order    @relation(fields: [orderId], references: [id])
  subscriptionId     String?
  telegramChargeId   String   @unique        // telegram_payment_charge_id: the idempotency guard
  amountStars        Int
  isRecurring        Boolean  @default(false)
  isFirstRecurring   Boolean  @default(false)
  subscriptionExpiresAt DateTime?
  refundedAt         DateTime?
  raw                Json                    // the full successful_payment object
  createdAt          DateTime @default(now())

  @@index([organizationId, mode, createdAt(sort: Desc)])   // analytics
  @@map("payment")
}

model Subscription {
  id                String             @id   // sub_…
  organizationId    String
  mode              Mode
  productId         String
  customerId        String
  orderId           String             @unique // the order that started it
  order             Order              @relation(fields: [orderId], references: [id])
  firstChargeId     String                     // needed for editUserStarSubscription
  status            SubscriptionStatus @default(active)
  currentPeriodEnd  DateTime
  cancelledAt       DateTime?
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt

  @@index([organizationId, mode, status])
  @@index([status, currentPeriodEnd])        // expiry job
  @@map("subscription")
}

model OrderEvent {                           // powers the timeline in the order drawer
  id        String   @id @default(cuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  type      String   // created | pre_checkout_approved | pre_checkout_rejected | paid | refunded | expired | webhook_delivered | webhook_failed
  data      Json     @default("{}")
  createdAt DateTime @default(now())
  @@index([orderId, createdAt])
  @@map("order_event")
}

model TelegramUpdate {                       // inbox: dedupe + debugging + health
  id          String    @id @default(cuid())
  botId       String
  updateId    BigInt
  type        String                         // pre_checkout_query | successful_payment | refunded_payment | message | other
  payload     Json
  receivedAt  DateTime  @default(now())
  processedAt DateTime?
  error       String?
  @@unique([botId, updateId])
  @@index([botId, receivedAt(sort: Desc)])
  @@map("telegram_update")
}

model WebhookEndpoint {
  id                String         @id       // we_…
  organizationId    String
  mode              Mode
  url               String
  events            String[]                 // [] = all events
  status            EndpointStatus @default(active)
  secretEncrypted   String                   // whsec_…; reversible because we sign with it
  prevSecretEncrypted String?
  prevSecretExpiresAt DateTime?              // old secret still signs for 24 h after rotation
  secretRotatedAt   DateTime?
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  deliveries        WebhookDelivery[]
  @@index([organizationId, mode])
  @@map("webhook_endpoint")
}

model WebhookEvent {                         // outbox row, written in the same tx as the state change
  id             String   @id                // evt_…
  organizationId String
  mode           Mode
  type           String                      // payment.succeeded, …
  orderId        String?
  data           Json                        // snapshot of the object at event time
  createdAt      DateTime @default(now())

  deliveries     WebhookDelivery[]
  @@index([organizationId, mode, createdAt(sort: Desc)])
  @@map("webhook_event")
}

model WebhookDelivery {
  id             String          @id         // whd_…
  eventId        String
  event          WebhookEvent    @relation(fields: [eventId], references: [id])
  endpointId     String
  endpoint       WebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)
  status         DeliveryStatus  @default(pending)
  attempts       Int             @default(0)
  maxAttempts    Int             @default(5)
  nextAttemptAt  DateTime        @default(now())
  lockedUntil    DateTime?
  lastStatusCode Int?
  lastLatencyMs  Int?
  lastError      String?
  lastResponse   String?                     // truncated to 2 KB
  deliveredAt    DateTime?
  createdAt      DateTime        @default(now())

  attemptLog     WebhookAttempt[]
  @@unique([eventId, endpointId])
  @@index([status, nextAttemptAt])           // dispatcher
  @@index([endpointId, createdAt(sort: Desc)]) // delivery log
  @@map("webhook_delivery")
}

model WebhookAttempt {
  id          String          @id @default(cuid())
  deliveryId  String
  delivery    WebhookDelivery @relation(fields: [deliveryId], references: [id], onDelete: Cascade)
  attempt     Int
  statusCode  Int?
  latencyMs   Int?
  error       String?
  response    String?
  createdAt   DateTime        @default(now())
  @@index([deliveryId])
  @@map("webhook_attempt")
}

model StarTransaction {                      // mirror of getStarTransactions → Balance screen
  id             String   @id @default(cuid())
  botId          String
  telegramTxId   String
  amount         Int                         // signed: + incoming, − outgoing
  kind           String                      // payment | refund | withdrawal | other
  orderId        String?
  date           DateTime
  raw            Json
  @@unique([botId, telegramTxId])
  @@index([botId, date(sort: Desc)])
  @@map("star_transaction")
}

model IdempotencyRecord {                    // public API POST replay protection
  id             String   @id @default(cuid())
  organizationId String
  mode           Mode
  key            String
  requestHash    String                      // sha256(method + path + body)
  statusCode     Int
  response       Json
  createdAt      DateTime @default(now())    // purged after 24 h
  @@unique([organizationId, mode, key])
  @@map("idempotency_record")
}

model AuditLog {                             // who refunded, rotated a secret, created a key, …
  id             String   @id @default(cuid())
  organizationId String
  mode           Mode?
  actorType      String                      // user | api_key | system
  actorId        String
  action         String                      // order.refund, api_key.create, webhook.rotate_secret, …
  targetId       String?
  data           Json     @default("{}")
  createdAt      DateTime @default(now())
  @@index([organizationId, createdAt(sort: Desc)])
  @@map("audit_log")
}
```

### Order state machine

```
created ──pre_checkout ok──► pre_checkout ──successful_payment──► paid ──refund──► refunded
   │                              │
   │ expiresAt passed             │ pre-checkout rejected / never completed
   ▼                              ▼
expired                        failed / expired
```
- Allowed transitions live in `core/orders/state.ts`, and every update is a conditional write: `updateMany({ where: { id, status: { in: allowedFrom } } })`. If the count is 0, the transition was invalid or lost a race.
- If a `successful_payment` arrives for an order that is `expired` or `failed`, **the money has still been taken**. Mark the order `paid` anyway and record an audit note. Never lose a payment.

### Repositories (`packages/db/src/repos/`)
Use Prisma directly in services for simple CRUD. Add repositories only where the SQL is non-trivial:
- `deliveryRepo.claimDue(limit)`: `UPDATE … WHERE id IN (SELECT … WHERE status='pending' AND next_attempt_at <= now() FOR UPDATE SKIP LOCKED LIMIT $1) RETURNING *`, which also sets `locked_until`.
- `analyticsRepo.overview(org, mode, range)`: aggregates and `date_trunc` buckets for the chart.
- `orderRepo.search(org, mode, { q, status, cursor })`: `q` matches an ID prefix, `@username`, a numeric Telegram ID, or a charge ID.
- `jobLock.tryRun(name, fn)`: wraps `pg_try_advisory_lock` so periodic jobs run on only one instance.

---

## 4. API surfaces

### 4.1 Public API: `/v1` (for merchant servers)

- **Auth:** `Authorization: Bearer live_sk_…` or `test_sk_…`. The mode comes from the key itself. Keys are 32 random bytes in base58, and only the sha256 hash is stored.
- **Transport:** oRPC `OpenAPIHandler`, contract-first, which also generates `/v1/openapi.json` and the reference docs.
- **Pagination:** cursors, `?limit=20&starting_after=ord_…`, returning `{ data, has_more }`.
- **Errors:** oRPC's error body, `{ "code": "ORDER_NOT_REFUNDABLE", "status": 409, "message": "…", "data": { "param": "product" } }`, with the HTTP status matching `status`. Codes are listed in `ErrorCode` (`packages/contracts/src/common.ts`); validation failures are `BAD_REQUEST` with `data.issues`. *(Decided during M0/M1 instead of a Stripe-style envelope: one error shape across `/rpc` and `/v1`, no custom encoder.)*
- **Idempotency:** every POST accepts `Idempotency-Key`. The same key with the same body replays the stored response. The same key with a different body returns `409`.
- **Rate limit:** 100 requests/second per key using an in-memory token bucket to start.

| Method & path | Purpose |
|---|---|
| `POST /v1/orders` | Create an order and a Telegram invoice link (see below) |
| `GET /v1/orders/:id` | Fetch an order |
| `GET /v1/orders` | List orders; filters `status`, `telegram_user_id`, `reference`, `created[gte/lte]` |
| `POST /v1/orders/:id/refund` | Refund a paid order (`refundStarPayment`) |
| `POST /v1/orders/:id/cancel` | Expire an unpaid order early |
| `GET/POST /v1/products`, `GET/PATCH /v1/products/:id` | Manage the catalogue (archive with `status: "archived"`) |
| `GET /v1/subscriptions`, `GET /v1/subscriptions/:id` | Subscription state |
| `POST /v1/subscriptions/:id/cancel`, `…/resume` | `editUserStarSubscription(is_canceled)` |
| `GET /v1/customers/:telegram_user_id` | Customer summary and spend |
| `GET /v1/balance` | Bot Star balance (cached, at most 60 s old) |

**`POST /v1/orders`** (the main call)
```jsonc
// request
{
  "product": "prod_8a…" | "nebula_skins",   // ID or lookup key
  "telegram_user_id": 6142883901,           // optional; if set, only this user can pay
  "reference": "order-3391",                // merchant's own ID, returned in webhooks
  "metadata": { "player_id": "p_42" },      // ≤ 20 keys, echoed back
  "expires_in": 3600,                       // seconds, default 3600, max 86400
  "delivery": "link"                        // "link" (default) | "message": sendInvoice to the user's chat
}
// 201 response: the Order object
{
  "id": "ord_9K2mQ7", "object": "order", "livemode": true,
  "status": "created", "amount": 250, "currency": "XTR",
  "product": { "id": "prod_8a…", "name": "Nebula Skin Pack", "type": "one_time" },
  "telegram_user_id": 6142883901, "reference": "order-3391", "metadata": { … },
  "invoice_link": "https://t.me/$AbC…", "expires_at": "…", "paid_at": null,
  "refunded_at": null, "subscription": null, "created_at": "…"
}
```

### 4.2 Merchant webhooks (outgoing)

**Events**, matching the design:

| Event | When |
|---|---|
| `payment.succeeded` | A one-time order, or the first subscription payment, was paid |
| `payment.refunded` | A refund was made through the API, the dashboard, or a `refunded_payment` update |
| `payment.failed` | Pre-checkout rejected: payer mismatch, archived product, or amount mismatch |
| `order.expired` | An unpaid order passed `expires_at` |
| `subscription.renewed` | A `successful_payment` with `is_recurring && !is_first_recurring` |
| `subscription.cancelled` | Cancelled through the API or the dashboard |
| `subscription.expired` | `currentPeriodEnd` passed without a renewal |

**Envelope**
```json
{ "id": "evt_…", "type": "payment.succeeded", "created_at": "…", "livemode": true,
  "data": { "object": { /* Order or Subscription object, as in /v1 */ } } }
```

**Headers**
- `X-StarPay-Event-Id`
- `X-StarPay-Event-Type`
- `X-StarPay-Signature: t=<unix>,v1=<hex hmac_sha256(secret, t + "." + rawBody)>`

During a secret rotation, there are two `v1=` values, one per active secret. Merchants must reject timestamps more than 5 minutes old.

**Delivery**
- Up to 5 attempts, matching the "1 / 5" in the design.
- Backoff: 0 → 1 min → 5 min → 30 min → 2 h → 6 h, with ±20% jitter.
- A 2xx within 10 s counts as success. Anything else, or a timeout, is a failure.
- After the last attempt: `status = failed`, the order timeline gets `webhook_failed`, and the merchant is notified.
- **Resend** creates a new delivery for the same event, so the event ID stays the same.

**Security:** endpoint URLs must be `https` in live mode. Reject any URL that resolves to a private or loopback IP (SSRF protection). Check this when the endpoint is saved **and** again at send time.

### 4.3 Dashboard RPC: `/rpc` (oRPC RPCHandler)

The context is `{ session, organizationId (session.activeOrganizationId), role, mode }`. `mode` comes from the `x-starpay-mode` header, which the Live/Test toggle sets. Middleware chain: `requireSession → requireOrg → withMode → requireRole(...)`.

| Router | Procedures | Min role |
|---|---|---|
| `overview` | `get({ range: "today"\|"7d"\|"30d" })` returns KPIs, chart series, health, and the last 5 payments | support |
| `orders` | `list({ status?, q?, cursor? })`, `get({ id })` (with timeline, payments, deliveries, raw payload), `refund({ id })` | support (refunds included) |
| `products` | `list`, `create`, `update`, `archive`, `unarchive` | developer |
| `subscriptions` | `stats`, `list({ status? })`, `cancel({ id })` | support |
| `customers` | `list({ q?, cursor? })`, `get({ id })` | support |
| `webhooks` | `endpoints.list/create/update/delete`, `revealSecret({ id })` (audited), `rotateSecret({ id })`, `sendTest({ id, type })`, `deliveries.list({ endpointId?, status?, cursor? })`, `deliveries.resend({ id })` | developer |
| `bot` | `get` (status, webhook info, token last 4), `connect({ token })`, `reconnect`, `disconnect` | developer |
| `apiKeys` | `list`, `create({ name })` (returns the full key once), `revoke({ id })` | developer |
| `balance` | `get`, `transactions({ cursor? })`, `sync` | support |
| `settings` | `get`, `update({ paySupportText?, notify*? })` | owner |
| `onboarding` | `status` returns `{ botConnected, hasProduct, hasTestPayment, hasWebhook }` | support |

Team management (invite, change role, remove) uses the Better-Auth organization client directly, with no custom procedures.

### 4.4 Telegram webhook: `POST /telegram/webhook/:botId`

This is a plain Hono route, not oRPC, because it needs the raw body and custom response bodies.

1. Look up the bot by `botId`. Constant-time compare `X-Telegram-Bot-Api-Secret-Token` with `bot.webhookSecret`. On mismatch return `401`.
2. Insert a `TelegramUpdate`. If `(botId, update_id)` already exists, return `200` without doing anything.
3. Route by update type:
   - **`pre_checkout_query`**: call `PaymentService.handlePreCheckout`. It does one indexed read and **no network calls**. Answer by **returning the method in the webhook response body**: `{ "method": "answerPreCheckoutQuery", "pre_checkout_query_id": …, "ok": true }`. That saves a round trip and stays well within Telegram's 10 s limit.
   - **`message.successful_payment`**: call `PaymentService.handleSuccessfulPayment` in one DB transaction, then return 200.
   - **`message.refunded_payment`**: call `RefundService.handleExternalRefund`.
   - **`/paysupport`, `/start`**: reply using `MerchantSettings.paySupportText`, again through the webhook response body.
   - Anything else: store it and return 200.
4. Set `processedAt`, or `error` if processing failed, and update `bot.lastUpdateAt`.
5. **Always return 200 unless the signature check failed.** Failures are handled on our side. Returning an error makes Telegram retry and back up the bot's update queue.

---

## 5. Contracts (`packages/contracts`)

```
contracts/src/
  common.ts        Mode, Stars (z.int().nonnegative()), Cursor, prefixed ID schemas, ErrorBody
  objects.ts       OrderObject, ProductObject, SubscriptionObject, CustomerObject, WebhookEventObject: the single source of truth for public JSON
  public/          oc contracts for /v1 (route() metadata: method, path, tags, successStatus)
    orders.ts products.ts subscriptions.ts customers.ts balance.ts index.ts
  dashboard/       oc contracts for /rpc (UI-shaped outputs, e.g. OverviewResult)
  webhooks.ts      event type union + envelope schema (exported for merchant SDKs)
```

Example:
```ts
export const createOrder = oc
  .route({ method: "POST", path: "/orders", successStatus: 201, tags: ["Orders"] })
  .input(CreateOrderInput)
  .output(OrderObject);
```

- The controllers in `packages/api` use `implement(publicContract)` / `implement(dashboardContract)`.
- The web app types its RPC client with `ContractRouterClient<typeof dashboardContract>`, so the web bundle never imports server code.
- **Serializers** (`core/serializers.ts`) convert Prisma rows into contract objects. This is the only place with rules like BigInt → number, snake_case for public objects, and hiding internal fields.

---

## 6. Services (`packages/core`)

| Service | Responsibilities | Telegram calls |
|---|---|---|
| `BotService` | Connect (getMe → encrypt → setWebhook with `secret_token` and `allowed_updates: ["message","pre_checkout_query"]` → setMyCommands `/paysupport`), health (getWebhookInfo), disconnect (deleteWebhook) | getMe, setWebhook, getWebhookInfo, deleteWebhook, setMyCommands |
| `ProductService` | CRUD and validation (title ≤ 32, description ≤ 255, subscription ⇒ period 2592000) | none |
| `OrderService` | `create`: load product → snapshot → create the Order (with idempotency) → `createInvoiceLink({ payload: order.id, currency: "XTR", prices: [{label, amount}], subscription_period? })` → store the link. Also `cancel`, `get`, `list` | createInvoiceLink, sendInvoice |
| `PaymentService` | `handlePreCheckout`: order exists, status `created`, not expired, amount and currency match, payer matches if set, product active → approve (status becomes `pre_checkout`) or reject with a readable message. `handleSuccessfulPayment`: in one tx, insert Payment (unique charge ID) → move the order to `paid` → upsert Customer and totals → create or extend the Subscription → OrderEvent → `EventService.emit` | none (answered through the webhook reply) |
| `RefundService` | `refund(orderId, actor)`: check paid, not refunded, and has a charge → `refundStarPayment` → tx: order `refunded`, payment `refundedAt`, customer totals −, OrderEvent, emit, AuditLog. `handleExternalRefund` handles the same thing when Telegram tells us about it | refundStarPayment |
| `SubscriptionService` | `cancel`/`resume` (editUserStarSubscription), `expireDue` (job) | editUserStarSubscription |
| `EventService` | `emit(tx, type, object)`: writes the WebhookEvent and one WebhookDelivery per matching active endpoint, **inside the caller's transaction** (outbox) | none |
| `WebhookEndpointService` | CRUD, SSRF check, secret generation, reveal, and rotation with a 24 h overlap, plus `sendTest` | none |
| `DeliveryService` | `dispatchBatch()`: claim due deliveries → sign → POST with a 10 s timeout → record the attempt → schedule the next one or finalise. Also `resend` | none |
| `ApiKeyService` | create (return plaintext once), `authenticate(rawKey)` (hash lookup, debounced `lastUsedAt` write), revoke | none |
| `BalanceService` | `sync(bot)`: getMyStarBalance and paged getStarTransactions → upsert StarTransaction and match rows to orders by charge ID | getMyStarBalance, getStarTransactions |
| `AnalyticsService` | Overview KPIs, chart buckets, conversion (orders paid ÷ orders created in the range), health summary | none |
| `CustomerService` | list, get, search | none |
| `IdempotencyService` | `withIdempotency(org, mode, key, requestHash, fn)` | none |

Shared helpers: `crypto.ts` (AES-GCM encrypt/decrypt, sha256, HMAC, random tokens), `ids.ts` (prefixed IDs), `clock.ts` (injectable, for tests).

---

## 7. Worker jobs (`apps/server/src/worker`)

| Job | Interval | Notes |
|---|---|---|
| Webhook dispatcher | every 2 s, batch of 50, 10 concurrent | `claimDue` uses SKIP LOCKED, so several instances are safe |
| Order expiry | 60 s | `status in (created, pre_checkout) and expiresAt < now` → `expired` and emit `order.expired` |
| Subscription expiry | 10 min | `active/cancelled and currentPeriodEnd < now − 1h grace` → `expired` and emit |
| Bot health | 5 min per bot | `getWebhookInfo`; if `last_error_message` is set, the bot becomes `webhook_error` |
| Balance sync | 10 min per bot, and on demand | `BalanceService.sync` |
| Cleanup | daily | Idempotency records older than 24 h, TelegramUpdate payloads older than 30 d, WebhookAttempt responses older than 30 d |

Periodic jobs are wrapped in `jobLock.tryRun`, which uses an advisory lock. On shutdown (SIGTERM), stop claiming new work and wait for in-flight deliveries to finish, up to 10 s.

---

## 8. Auth and security

- **Better-Auth plugins to add:**
  - `organization`: roles `owner`, `developer`, `support`.
  - `bearer`: sessions for the Telegram Mini App.
  - Later, a custom `telegram` plugin that verifies the Mini App's `initData` and supports Telegram Login.
- **Cookies:** the scaffold sets `sameSite: "none"` for cross-site cookies. Once `app.` and `api.` share a parent domain, switch to `sameSite: "lax"` with `crossSubDomainCookies`.
- **Secrets at rest:** bot tokens and webhook signing secrets are AES-256-GCM encrypted with `ENCRYPTION_KEY`, with a key-version prefix (`v1:`) so the key can be rotated. API keys are stored as sha256 hashes only.
- **Never log** bot tokens, full API keys, or `initData`. Telegram URLs contain the token, so the telegram client redacts it from errors.
- **New env vars:** `ENCRYPTION_KEY` (base64, 32 bytes), `PUBLIC_API_URL` (base URL for Telegram webhooks), `WORKER_ENABLED` (default true).

---

## 9. Changes to the scaffold

1. **DB adapter.** ✅ Switched to `@prisma/adapter-pg`. It works with local Postgres (docker-compose, port 5433) and with the direct connection string Alchemy passes in production, and interactive transactions are covered by the tests.
2. **Server entry.** Split `index.ts` so `/rpc` → dashboard router, `/v1` → public OpenAPI router, `/telegram/*` → Hono route. Remove the demo `privateData` procedure. Move `/api-reference` to `/v1/docs`.
3. **Alchemy.** `server` has `framework: "bun"` but `runtime: node` and `tsx`. Make them match (set it to node). Add the new env vars.
4. **CORS.** `allowMethods` needs `PATCH`/`DELETE`. `allowHeaders` needs `x-starpay-mode` and `Idempotency-Key`. The public `/v1` doesn't need CORS at all, since it's called server-to-server.
5. `pnpm auth:generate` after adding the plugins, then `db:migrate`.

---

## 10. Differences between the design and this plan

| # | Design | Decision |
|---|---|---|
| 1 | Snippet uses `POST /v1/invoices` with `product_id` and `payload` | Use `POST /v1/orders` with `product` and `reference`, so there's one resource name everywhere and `payload` isn't confused with Telegram's `invoice_payload`. Update the snippet |
| 2 | Drawer shows `API key: live_pk_…`, keys page shows `live_sk_…` | Only secret keys (`live_sk_` / `test_sk_`). There are no publishable keys in v1 |
| 3 | "payment.failed" | Means *pre-checkout rejected*. Stars payments don't fail after Telegram approves them |
| 4 | "subscription.cancelled" when a subscriber leaves | Telegram (as far as I know) sends **no update** when a *user* cancels in Telegram. We only know about cancellations made through us; user cancellations show up as `subscription.expired`. Verify against the current Bot API |
| 5 | A single webhook endpoint card | The schema supports several endpoints. The UI can show one for now |
| 6 | The Test toggle | Requires a second bot token on Telegram's **test server**. Onboarding must explain this |
| 7 | "Withdrawable 21 days after payment" | Load this text from config. Telegram has changed the hold period before |
| 8 | Product photo | Just a `photoUrl` for now. Uploads (S3/R2) come later |
| 9 | Bot health "pre-checkout p95" | Record the processing time per `TelegramUpdate`, then compute p95 in the overview query |

---

## 11. Open questions (need a product decision)

1. **Exclusive bot use.** A bot can only have **one webhook**. If a merchant's bot also runs its own logic (a game bot, for example), StarPay would take over its updates. Options: (a) require a dedicated payments bot, the simplest; (b) forward all non-payment updates to a merchant URL, a proxy mode that adds latency and one more failure point. **Recommendation: (a) for v1.**
2. **Custom prices.** Should `POST /v1/orders` accept a custom amount and title without a product? Games often want dynamic bundles. Recommendation: allow it in v2, behind a `line_item` field.
3. Notification channels: Telegram DMs from a StarPay system bot, email (which provider?), or both.
4. How StarPay itself makes money: free, a flat subscription, or usage-based. This affects whether a `plan` table and Polar are needed later.

---

## 12. Milestones

| # | Deliverable | Done when |
|---|---|---|
| **M0 Foundations** ✅ | New packages, env vars, schema and migration, crypto/ids, telegram client (test env), org plugin, mode middleware, adapter spike | `pnpm check-types` passes; a migration applies to the dev DB |
| **M1 First payment** ✅ code + tests; needs a real test-server bot run | Bot connect, products, `POST /v1/orders`, Telegram webhook, pre-checkout, successful payment | A real test-environment bot sells an item end to end and the order shows `paid` |
| **M2 Webhooks** | Endpoints, outbox, dispatcher, signing, retries, resend, test event | The merchant receives a signed `payment.succeeded`; killing the endpoint produces retries |
| **M3 Dashboard core** | Overview, Payments and drawer, refunds, Customers, Bot & API, API keys | The design screens render real data |
| **M4 Money details** | Subscriptions (create, renew, cancel, expire), balance sync, `/paysupport`, settings, audit log | A subscription renews on the test server; the balance matches Telegram |
| **M6 Hosted mode** ✅ code + tests; payouts need a funded TON wallet | Platform bot, double-entry ledger, fee plans, hold/reserve, TON payouts, platform admin | Hosted payment books fee and net; payout leaves the treasury; books balance |
| **M5 Reach** | Telegram Mini App mode and bearer auth, OpenAPI docs at `/v1/docs`, TS SDK generated from the contracts, notifications | The dashboard opens inside Telegram |

**Testing:** Vitest. Services are tested against a real Postgres (a Docker container or `prisma dev`) with a fake telegram client. Signature and backoff get unit tests with fixed values. One end-to-end script drives M1 against Telegram's test server.


---

## 13. Hosted mode: ledger, fees and payouts

Hosted merchants sell through **StarPay's platform bot**, so their money passes through StarPay. That makes StarPay a custodian, and the design follows from it: the money must be tracked to the Star, and every movement must be explainable.

### Settlement choice

`bots.invoiceBot(scope)` picks the bot for each new order: the merchant's own if connected (`settlement = "direct"`), otherwise the platform bot (`settlement = "platform"`). The order records both `botId` and `settlement`, so a Telegram update is always matched to the bot that issued its invoice, and switching later never rewrites history.

### The ledger

Double-entry, denominated in whole Stars, in `ledger_account` / `ledger_transaction` / `ledger_entry`:

| Account | Kind | Meaning |
|---|---|---|
| `platform_telegram` | asset | Stars sitting in the platform bot's Telegram balance |
| `platform_treasury` | asset | value withdrawn via Fragment, less payouts sent (negative = StarPay fronting TON) |
| `platform_fees` | revenue | StarPay's commission |
| `merchant_pending` | liability | a merchant's earnings still inside the hold period |
| `merchant_available` | liability | released earnings they can withdraw |
| `merchant_payouts` | liability | payouts requested but not yet sent |

Rules the code and the database both enforce:
- **Every transaction sums to zero** (deferred constraint trigger), so a half-written movement can't commit.
- **Entries are append-only** (triggers reject UPDATE and DELETE). Corrections are new transactions.
- **Balances are never stored.** They are always `SUM(amount)` over entries; there is no `merchant.balance` column to drift.
- **Postings are idempotent** via `idempotencyKey` (`payment:<id>`, `release:<id>`, `refund:<id>`, `payout_*:<id>`).

Movements:

```
payment          platform_telegram +gross | merchant_pending −net | platform_fees −fee
release          merchant_pending  +net   | merchant_available −net        (after hold_days)
refund           platform_telegram −gross | platform_fees +fee | pending/available +net
payout_request   merchant_available +(amount+fee) | merchant_payouts −amount | platform_fees −fee
payout_paid      merchant_payouts  +amount | platform_treasury −amount
payout_reversed  merchant_payouts  +amount | platform_fees +fee | merchant_available −(amount+fee)
fragment_withdrawal  platform_treasury +stars | platform_telegram −stars
```

A refund reverses the fee too, so the books mirror the original sale. A refund of money already paid out can push `merchant_available` negative: that debt is settled by future earnings, and payouts are blocked until it clears.

### Fees

`fee_plan` holds the commercial terms: `percentBps` + `fixedStars` per payment, `payoutFeeStars`, `minPayoutStars`, `holdDays`, and a rolling reserve (`reserveBps` over `reserveDays`). One plan is the default; a merchant can be assigned another. The fee is computed at payment time (percentage rounded half up, never more than the payment) and **stored on the payment**, so later plan changes never rewrite past sales. Defaults: 5%, 21-day hold, 10% reserve over 30 days, 1,000-Star minimum payout.

The reserve is measured from `availableAt` (when money became available), not from when the release job happened to run, so a late job can't extend it.

### Payouts

A payout moves Stars out of `merchant_available` and sends TON to the merchant's wallet. Safeguards:
- **No double spend:** the request locks the merchant's `merchant_available` account row (`FOR UPDATE`) and rechecks the balance inside the same transaction.
- **Manual by default:** with no hot wallet configured, payouts wait in the admin queue and are marked paid (with a TON transaction reference) or failed, which returns the Stars and the payout fee.
- **Automatic sending is replay-safe:** the wallet's seqno is reserved and saved *before* sending. A crash mid-send is resolved by reading the wallet's seqno, not by sending again; a message that expired unaccepted is retried with the *same* seqno, which the wallet contract accepts only once. Only one transfer is ever in flight per wallet.
- Conversion uses Telegram's Star rate (`STAR_USD_RATE`, default $0.013) and TON/USD from tonapi, both recorded on the payout.

### Platform admin

`PLATFORM_ADMIN_USER_IDS` lists the StarPay staff who can open `/admin`: platform balances with a **reconciliation check against Telegram's reported balance**, the payout queue, recording Fragment withdrawals, fee plans, and per-merchant plan assignment.

### Open risks (unchanged by the code)

1. Telegram can withhold or debit the platform bot's balance (Bot Developer Terms §6.2.4), which affects every hosted merchant at once.
2. Holding and paying out other people's money is regulated in most countries; check licensing and merchant KYC before hosted mode takes real money.
3. The hot wallet is a theft target: keep only the working float in it.
