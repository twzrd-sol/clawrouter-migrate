import { readFileSync } from "node:fs";

/**
 * Load a 32-byte Solana private seed. Never log the return value.
 *
 * --wallet-file: JSON array of 32 or 64 numbers (Solana keypair JSON).
 * SOLANA_WALLET_KEY: same JSON, or 64-char hex of the 32-byte seed.
 */
export function loadSolanaSeed(opts: { walletFile?: string; env?: NodeJS.ProcessEnv } = {}): Uint8Array | undefined {
  if (opts.walletFile) {
    return parseSecret(readFileSync(opts.walletFile, "utf8"), "wallet-file");
  }
  const raw = opts.env?.SOLANA_WALLET_KEY;
  if (!raw) return undefined;
  return parseSecret(raw, "SOLANA_WALLET_KEY");
}

function parseSecret(raw: string, source: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || !parsed.every((n) => Number.isInteger(n))) {
      throw new Error(`${source} must be a JSON array of integers`);
    }
    if (parsed.length !== 32 && parsed.length !== 64) {
      throw new Error(`${source} must be a 32- or 64-byte Solana secret`);
    }
    return Uint8Array.from(parsed.slice(0, 32));
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Uint8Array.from(Buffer.from(trimmed, "hex"));
  }
  throw new Error(`${source} must be a JSON integer array or 64-char hex seed`);
}
