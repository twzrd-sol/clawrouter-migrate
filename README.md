# @twzrd-sol/clawrouter-migrate

One command that proves a local [ClawRouter](https://github.com/BlockRunAI/ClawRouter) path and prints a rewrite snippet for OpenRouter / OpenAI / OpenClaw clients.

The npm scope is temporary. If BlockRun blesses the package, this graduates to `@blockrun/clawrouter-migrate` and later `clawrouter migrate`.

Requires `@blockrun/clawrouter` **>= 0.12.249** (the floor that already ran free and paid canaries).

```bash
npx @twzrd-sol/clawrouter-migrate
npx @twzrd-sol/clawrouter-migrate --paid --ceiling 0.05
```

## What it does

1. Detects the current surface (`OPENROUTER_*`, `OPENAI_*`, `~/.openclaw`, or unknown)
2. Starts an **isolated** ClawRouter proxy on a free port (never 8402)
3. Runs a free canary (`free/*` → HTTP 200, $0, no 402)
4. Optionally runs a pinned paid canary (`deepseek/deepseek-chat`) under a pre-sign ceiling
5. Writes `migrated-<timestamp>.profile.yaml` and prints a `baseURL` + `apiKey: "x402"` snippet
6. Stops the proxy unless `--keep-running`

Free failure exits non-zero and does not claim migrated. Missing paid funds skips paid and still succeeds.

## Isolation guarantees

- Unused listen port; refuses the default production port 8402
- In-memory spend policy (does not write `~/.openclaw/blockrun/spending.json`)
- Temporary `HOME` so accidental persistence stays off the operator home
- Ephemeral wallet unless `--persist-wallet` (0600 `*.wallet.json`, gitignored). Skipped when `--wallet-file` or `SOLANA_WALLET_KEY` already supplied the paid signer — that flag must not write a different generated mnemonic.
- Response cache off so the canary is a real request
- Never prints key material
- Detected OpenRouter / OpenAI keys are ignored and never uploaded
- Partners / phone / media are not invoked (only `/v1/models` and `/v1/chat/completions`)

Paid ceilings get estimator slack: a strict `$0.001` run cap 429s on a `$0.0012` estimate. The session cap is `max(--ceiling, 0.002)`.

`ProxyOptions.onPayment` is not treated as a receipt. The signed-payment log supplies the USD amount. A Solscan link is attached only when a **new** signature appears after the paid call and (when the amount is known) the USDC debit matches — not merely the wallet’s latest historical transaction.

## Paid wallet

```bash
npx @twzrd-sol/clawrouter-migrate --paid --ceiling 0.05 --wallet-file ./solana.json
```

`--wallet-file` is a Solana secret JSON array (32-byte seed or 64-byte keypair). `SOLANA_WALLET_KEY` accepts the same JSON or a 64-character hex seed. The CLI does not read any default host wallet path.

## Canary contract

```text
surface | proxy | wallet(pubkey only) | ceiling | free: ok|fail | paid: ok|skip|fail | receipt | profile
```

`--json` prints the same fields as an object.

## v0.1 non-goals

OpenRouter parity board, profile registry, partner/phone/media enablement, GitHub Action CI, and a ClawRouter core PR.
