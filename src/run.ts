import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "./args.js";
import {
  listRecentSignatures,
  parseSignedPaymentLog,
  pollCanarySignature,
  PAID_CANARY_MODEL,
  runFreeCanary,
  runPaidCanary,
  solscanUrl,
} from "./canary.js";
import { detectSurface } from "./detect.js";
import { withConsoleCapture } from "./logs.js";
import { profileFilename, renderProfile } from "./profile.js";
import { sessionCap, startIsolatedProxy } from "./proxy.js";
import { rewriteSnippet } from "./rewrite.js";
import type { CliArgs, MigrateResult, PaidCanary, RunDeps } from "./types.js";
import { loadSolanaSeed } from "./wallet.js";

export async function runMigrate(args: CliArgs, deps: RunDeps): Promise<MigrateResult> {
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();
  const now = deps.now?.() ?? new Date();
  const detect = deps.detect ?? detectSurface;
  const freeFn = deps.runFreeCanary ?? ((baseUrl: string) => runFreeCanary(baseUrl));
  const paidFn = deps.runPaidCanary ?? ((baseUrl: string) => runPaidCanary(baseUrl));

  const detected = detect({ env, homedir: deps.homedir });
  const solanaSeed = args.paid ? loadSolanaSeed({ walletFile: args.walletFile, env }) : undefined;

  const handle = await deps.startProxy({
    port: args.port,
    ceiling: args.ceiling,
    paid: args.paid,
    solanaPrivateKeyBytes: solanaSeed,
    persistWallet: args.persistWallet,
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await handle.close();
  };

  try {
    const free = await freeFn(handle.baseUrl);
    if (!free.ok) {
      await close();
      return finish({
        surface: detected.surface,
        proxy: handle.baseUrl,
        wallet: handle.walletAddress,
        ceiling: args.ceiling,
        effectiveSessionCap: sessionCap(args.ceiling),
        free: "fail",
        paid: "skip",
        receipt: "",
        profile: "",
        freeModel: free.model,
        rewrite: "",
        keepRunning: false,
      });
    }

    let paid: PaidCanary = {
      model: PAID_CANARY_MODEL,
      usdc: 0,
      ok: "skip",
      receipt: "",
      reason: args.paid ? "no funded wallet; re-run --paid with --wallet-file or SOLANA_WALLET_KEY" : undefined,
    };

    // Stays true unless a real paid call lands with no parsable amount.
    let paidUsdcKnown = true;
    if (args.paid && solanaSeed) {
      const address = handle.solanaAddress ?? handle.walletAddress;
      let before: string[] | null = null;
      try {
        before = deps.listSignatures
          ? await deps.listSignatures(address)
          : handle.solanaAddress
            ? await listRecentSignatures(handle.solanaAddress)
            : null;
      } catch {
        before = null;
      }
      const captured = await withConsoleCapture(() => paidFn(handle.baseUrl));
      paid = captured.value;
      const signed = captured.lines.map(parseSignedPaymentLog).find((n) => n !== undefined);
      if (signed !== undefined) paid.usdc = signed;
      // A settled call whose amount we could not read is an attribution gap,
      // not a $0 run — the provider log wording is a peer-library contract.
      if (paid.ok === "ok" && !(paid.usdc > 0)) {
        paidUsdcKnown = false;
        paid.reason ??= "no signed-payment amount in provider log; spend unverified";
      }
      if (before !== null && paid.usdc > 0 && (paid.ok === "ok" || signed !== undefined)) {
        // Receipt attribution whenever money moved, even if the chat request
        // itself failed; polling because RPC indexing lags settlement.
        // A failed before-snapshot is not treated as [] — that would make
        // historical txs look new.
        const sig = await (deps.findReceipt ?? pollCanarySignature)({
          solanaAddress: address,
          before,
          amountUsd: paid.usdc,
        });
        if (sig) paid.receipt = solscanUrl(sig);
      }
    }

    if (paid.ok === "fail") {
      await close();
      return finish({
        surface: detected.surface,
        proxy: handle.baseUrl,
        wallet: handle.walletAddress,
        ceiling: args.ceiling,
        effectiveSessionCap: sessionCap(args.ceiling),
        free: "ok",
        paid: "fail",
        receipt: paid.receipt,
        profile: "",
        freeModel: free.model,
        paidModel: paid.model,
        paidUsdc: paid.usdc,
        rewrite: "",
        keepRunning: false,
      });
    }

    const profileName = profileFilename(now);
    const profilePath = join(cwd, profileName);
    const yaml = renderProfile({
      surface: detected.surface,
      port: handle.port,
      maxCostPerRequest: args.ceiling,
      maxCostPerSession: Math.max(args.ceiling, 0.002),
      free: { model: free.model, ok: true },
      paid: { model: paid.model, usdc: paid.usdc, ok: paid.ok, usdcKnown: paidUsdcKnown },
      rollbackBaseUrl: detected.rollbackBaseUrl,
    });
    (deps.writeProfile ?? writeFileSync)(profilePath, yaml);

    if (args.persistWallet && handle.mnemonic && !solanaSeed) {
      const walletPath = join(cwd, profileName.replace(/\.profile\.yaml$/, ".wallet.json"));
      (deps.persistWallet ?? writeSecure)(
        walletPath,
        JSON.stringify({ mnemonic: handle.mnemonic, address: handle.walletAddress }),
      );
    }

    const rewrite = rewriteSnippet(detected.surface, handle.port);
    if (!args.keepRunning) await close();

    return finish({
      surface: detected.surface,
      proxy: handle.baseUrl,
      wallet: handle.walletAddress,
      ceiling: args.ceiling,
      effectiveSessionCap: sessionCap(args.ceiling),
      free: "ok",
      paid: paid.ok,
      receipt: paid.receipt,
      profile: profilePath,
      freeModel: free.model,
      paidModel: paid.model,
      paidUsdc: paid.usdc,
      paidUsdcKnown,
      rewrite,
      keepRunning: args.keepRunning,
    });
  } catch (err) {
    await close();
    throw err;
  }
}

function finish(result: MigrateResult): MigrateResult {
  return result;
}

function writeSecure(path: string, contents: string): void {
  writeFileSync(path, contents, { mode: 0o600 });
}

export function defaultDeps(): RunDeps {
  return { startProxy: startIsolatedProxy };
}

export { parseArgs };
