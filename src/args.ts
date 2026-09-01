import type { CliArgs } from "./types.js";

const DEFAULT_CEILING = 0.05;

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    paid: false,
    ceiling: DEFAULT_CEILING,
    keepRunning: false,
    persistWallet: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--paid") {
      args.paid = true;
    } else if (arg === "--keep-running") {
      args.keepRunning = true;
    } else if (arg === "--persist-wallet") {
      args.persistWallet = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--ceiling") {
      const raw = argv[++i];
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`--ceiling must be a positive number (got ${raw})`);
      }
      args.ceiling = value;
    } else if (arg === "--wallet-file") {
      const raw = argv[++i];
      if (!raw) throw new Error("--wallet-file requires a path");
      args.walletFile = raw;
    } else if (arg === "--port") {
      const raw = argv[++i];
      const value = Number(raw);
      if (!Number.isInteger(value) || value <= 0 || value > 65535) {
        throw new Error(`--port must be a valid TCP port (got ${raw})`);
      }
      if (value === 8402) {
        throw new Error("refusing port 8402 — that is the default production ClawRouter proxy");
      }
      args.port = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return args;
}

export const HELP = `clawrouter-migrate — prove a local ClawRouter path and print a rewrite snippet

Usage:
  npx @twzrd-sol/clawrouter-migrate
  npx @twzrd-sol/clawrouter-migrate --paid --ceiling 0.05

Options:
  --paid              Run a pinned cheap paid canary after free succeeds
  --ceiling <usd>     Paid session/request ceiling (default 0.05)
  --wallet-file <p>   Solana secret JSON (32- or 64-byte array). Never printed
  --persist-wallet    Write a 0600 ephemeral mnemonic (skipped if --wallet-file or SOLANA_WALLET_KEY)
  --keep-running      Leave the isolated proxy up after the canary
  --port <n>          Isolated listen port (not 8402)
  --json              Machine-readable result object
  --help              Show this help

Env:
  SOLANA_WALLET_KEY   JSON array or 64-char hex seed for --paid (never printed)

The package name is temporary. If BlockRun blesses it, this becomes
@blockrun/clawrouter-migrate and later \`clawrouter migrate\`.
`;
