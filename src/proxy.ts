import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAllowlistGate } from "./allowlist.js";
import { assertPortAvailable, PRODUCTION_PROXY_PORT } from "./port.js";
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
    const requested = opts.port;
    if (requested === PRODUCTION_PROXY_PORT) {
      throw new Error("refusing to bind the production ClawRouter port 8402");
    }
    if (requested !== undefined) await assertPortAvailable(requested);

    // Port 0, never a pre-picked one. startProxy probes the port it is handed
    // and silently *reuses* any listener answering /health — returning that
    // proxy's wallet, ignoring our spend caps, and handing back a no-op
    // close(). Finding a free port and then passing it leaves a window for a
    // same-host process to occupy it first. Letting the kernel assign the port
    // inside bind() closes that window: nothing can be listening on it yet.
    const upstream = hooks.startUpstream
      ? await hooks.startUpstream({ port: 0 })
      : await startClawRouterUpstream(opts, 0);
    if (!upstream.port || upstream.port === PRODUCTION_PROXY_PORT) {
      await upstream.close();
      throw new Error(`upstream reported an unusable port ${upstream.port}`);
    }

    let gate;
    try {
      gate = await startAllowlistGate({
        listenPort: requested ?? 0,
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
