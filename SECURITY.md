# Security

StarPay handles payments, and in hosted mode it holds funds on behalf of merchants. It has **not** been independently audited.

## Reporting a vulnerability

Please report privately through GitHub's [private vulnerability reporting](https://github.com/kichuu/starpay/security/advisories/new) rather than opening a public issue. Include what you found, how to reproduce it, and what an attacker could achieve.

Please don't test against anyone else's deployment — run it locally.

## What the code already does

- **Bot tokens and webhook signing secrets** are encrypted at rest (AES-256-GCM) with `ENCRYPTION_KEY`; API keys are stored only as SHA-256 hashes.
- **Telegram updates** are authenticated with a per-bot secret token, compared in constant time, and de-duplicated by update ID.
- **Webhook endpoints** must be public HTTPS; DNS is resolved and private, loopback and link-local addresses are refused, and redirects are not followed (SSRF).
- **Outgoing webhooks** are signed (HMAC-SHA256 over `timestamp.body`) with a timestamp for replay protection.
- **The ledger** is append-only and every transaction must sum to zero, both enforced by database triggers, and payout requests lock the account row so a balance can't be spent twice.

## Running it safely

- `ENCRYPTION_KEY` decrypts every stored bot token. Back it up, and never reuse the development key in production.
- Give the TON payout hot wallet only a working float, and keep the rest in a wallet whose keys aren't on the server.
- Rotate any secret that has ever been printed to a log, a terminal, or a chat.
