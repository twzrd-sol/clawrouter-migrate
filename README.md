# @wzrd_sol/clawrouter-migrate

One command that proves a local [ClawRouter](https://github.com/BlockRunAI/ClawRouter) path and prints a rewrite snippet for OpenRouter / OpenAI / OpenClaw clients.

This repository is **0.1.4**. Package name is `@wzrd_sol/clawrouter-migrate`; GitHub is `twzrd-sol/clawrouter-migrate`. `npx @wzrd_sol/clawrouter-migrate` installs the latest published npm release, which may lag the repo.

Requires `@blockrun/clawrouter` **>= 0.12.249**.

```bash
npx @wzrd_sol/clawrouter-migrate
npx @wzrd_sol/clawrouter-migrate --paid --ceiling 0.05
```

## What it does

1. Detects the current surface (`OPENROUTER_*`, `OPENAI_*`, `~/.openclaw`, or unknown)
2. Starts an isolated ClawRouter proxy behind an OpenAI-path allowlist on an unused local port
3. Runs a free canary (`free/*` → HTTP 200, $0, no 402)
4. Optionally runs a pinned paid canary (`deepseek/deepseek-chat`) under a pre-sign ceiling
5. Writes `migrated-<timestamp>.profile.yaml` and prints a `baseURL` + `apiKey: "x402"` snippet
6. Stops the proxy unless `--keep-running`

Free failure exits non-zero and does not claim migrated. Missing paid funds skips paid and still succeeds.

## Isolation

- Unused local listen port; `--port` is refused if something is already listening
- In-memory spend policy (does not write host spend files)
- Temporary `HOME` so the run does not persist into the calling home directory
- Ephemeral wallet unless `--persist-wallet` (0600 `*.wallet.json`, gitignored). Skipped when `--wallet-file` or `SOLANA_WALLET_KEY` already supplies the paid signer
- Response cache off so the canary is a real request
- Never prints key material
- Detected OpenRouter / OpenAI keys are ignored and never uploaded
- Only OpenAI-compatible paths (`/v1/models`, `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`) are forwarded; other routes are blocked

Paid `--ceiling` is a session cap. The run uses a small floor so a tight `$0.001` request estimate is not rejected immediately.

Receipts come from the signed-payment log, not from `ProxyOptions.onPayment`. A Solscan link is added only when a new matching USDC debit is observed after the paid call.

## Paid wallet

```bash
npx @wzrd_sol/clawrouter-migrate --paid --ceiling 0.05 --wallet-file ./solana.json
```

`--wallet-file` is a Solana secret JSON array (32-byte seed or 64-byte keypair). `SOLANA_WALLET_KEY` accepts the same JSON or a 64-character hex seed. The CLI does not read any default host wallet path.

## Output

```text
surface | proxy | wallet(pubkey only) | ceiling | free: ok|fail | paid: ok|skip|fail | receipt | profile
```

`--json` prints the same fields as an object.
