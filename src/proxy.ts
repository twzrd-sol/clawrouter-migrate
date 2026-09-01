import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPortAvailable, findFreePort, PRODUCTION_PROXY_PORT } from "./port.js";
import type { IsolatedHandle, StartIsolatedOpts } from "./types.js";

/** Session cap must exceed the DeepSeek estimator (~$0.0012) or a $0.001 settle 429s. */
export function sessionCap(ceiling: number): number {
  return Math.max(ceiling, 0.002);
}

export async function startIsolatedProxy(opts: StartIsolatedOpts): Promise<IsolatedHandle & { tmpHome: string }> {
  const tmpHome = mkdtempSync(join(tmpdir(), "clawrouter-migrate-"));
  const prevHome = process.env.HOME;
  process.env.HOME = tmpHome;

  try {
    // Import only after HOME is redirected: the peer lib resolves its
    // ~/.openclaw log/response dirs from homedir() at module-init time.
    const claw = await import("@blockrun/clawrouter");
    const port = opts.port ?? (await findFreePort());
    if (port === PRODUCTION_PROXY_PORT) {
      throw new Error("refusing to bind the production ClawRouter port 8402");
    }
    await assertPortAvailable(port);

    const cap = sessionCap(opts.ceiling);
    const spend = new claw.SpendControl({ storage: new claw.InMemorySpendControlStorage() });
    spend.setLimit("perRequest", cap);
    spend.setLimit("session", cap);

    const mnemonic = claw.generateWalletMnemonic();
    const keys = claw.deriveAllKeys(mnemonic);
    const solanaBytes = opts.solanaPrivateKeyBytes ?? keys.solanaPrivateKeyBytes;

    const handle = await claw.startProxy({
      wallet: { key: keys.evmPrivateKey, solanaPrivateKeyBytes: solanaBytes },
      port,
      paymentChain: opts.paid && opts.solanaPrivateKeyBytes ? "solana" : undefined,
      spendControl: spend,
      maxCostPerRunUsd: cap,
      maxCostPerRunMode: "strict",
      cacheConfig: { enabled: false },
      skipBalanceCheck: !opts.paid || !opts.solanaPrivateKeyBytes,
    });

    const display = handle.solanaAddress ?? handle.walletAddress;

    return {
      port: handle.port,
      baseUrl: handle.baseUrl,
      walletAddress: display,
      solanaAddress: handle.solanaAddress,
      mnemonic: opts.persistWallet && !opts.solanaPrivateKeyBytes ? mnemonic : undefined,
      tmpHome,
      close: async () => {
        try {
          await handle.close();
        } finally {
          process.env.HOME = prevHome;
          try {
            rmSync(tmpHome, { recursive: true, force: true });
          } catch {
            // isolated temp dir is best-effort
          }
        }
      },
    };
  } catch (err) {
    process.env.HOME = prevHome;
    try {
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // isolated temp dir is best-effort
    }
    throw err;
  }
}

export { sessionCap as isolatedSessionCap };
