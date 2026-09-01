import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAllowlistGate } from "./allowlist.js";
import { assertPortAvailable, findFreePort, PRODUCTION_PROXY_PORT } from "./port.js";
import type { IsolatedHandle, StartIsolatedOpts } from "./types.js";

/** Session cap must exceed the DeepSeek estimator (~$0.0012) or a $0.001 settle 429s. */
export function sessionCap(ceiling: number): number {
  return Math.max(ceiling, 0.002);
}

/** Test-only seam so the allowlist gate can be proven without importing ClawRouter. */
export type IsolatedUpstreamHandle = {
  port: number;
  baseUrl: string;
  walletAddress: string;
  solanaAddress?: string;
  mnemonic?: string;
  close: () => Promise<void>;
};

export type IsolatedProxyHooks = {
  startUpstream?: (input: { port: number }) => Promise<IsolatedUpstreamHandle>;
};

export async function startIsolatedProxy(
  opts: StartIsolatedOpts,
  hooks: IsolatedProxyHooks = {},
): Promise<IsolatedHandle & { tmpHome: string }> {
  const tmpHome = mkdtempSync(join(tmpdir(), "clawrouter-migrate-"));
  const prevHome = process.env.HOME;
  process.env.HOME = tmpHome;

  try {
    const advertised = opts.port ?? (await findFreePort());
    if (advertised === PRODUCTION_PROXY_PORT) {
      throw new Error("refusing to bind the production ClawRouter port 8402");
    }
    await assertPortAvailable(advertised);
    const internal = await findFreePort(new Set([PRODUCTION_PROXY_PORT, advertised]));

    const upstream = hooks.startUpstream
      ? await hooks.startUpstream({ port: internal })
      : await startClawRouterUpstream(opts, internal);

    let gate;
    try {
      gate = await startAllowlistGate({
        listenPort: advertised,
        upstreamPort: upstream.port,
      });
    } catch (err) {
      await upstream.close();
      throw err;
    }

    return {
      port: gate.port,
      baseUrl: gate.baseUrl,
      walletAddress: upstream.walletAddress,
      solanaAddress: upstream.solanaAddress,
      mnemonic: upstream.mnemonic,
      tmpHome,
      close: async () => {
        try {
          await gate.close();
        } finally {
          try {
            await upstream.close();
          } finally {
            restoreHome(prevHome, tmpHome);
          }
        }
      },
    };
  } catch (err) {
    restoreHome(prevHome, tmpHome);
    throw err;
  }
}

async function startClawRouterUpstream(
  opts: StartIsolatedOpts,
  port: number,
): Promise<IsolatedUpstreamHandle> {
  // Import only after HOME is redirected: the peer lib resolves its
  // ~/.openclaw log/response dirs from homedir() at module-init time.
  const claw = await import("@blockrun/clawrouter");

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

  return {
    port: handle.port,
    baseUrl: handle.baseUrl,
    walletAddress: handle.solanaAddress ?? handle.walletAddress,
    solanaAddress: handle.solanaAddress,
    mnemonic: opts.persistWallet && !opts.solanaPrivateKeyBytes ? mnemonic : undefined,
    close: () => handle.close(),
  };
}

function restoreHome(prevHome: string | undefined, tmpHome: string): void {
  // Assigning `undefined` to process.env coerces to the string "undefined",
  // which would leave the caller with a HOME pointing at a nonexistent dir.
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  try {
    rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // isolated temp dir is best-effort
  }
}

export { sessionCap as isolatedSessionCap };
