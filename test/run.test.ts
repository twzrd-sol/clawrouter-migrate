import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";
import { humanBlock } from "../src/report.js";
import { runMigrate } from "../src/run.js";
import type { IsolatedHandle, RunDeps } from "../src/types.js";

function mockHandle(): IsolatedHandle {
  return {
    port: 8411,
    baseUrl: "http://127.0.0.1:8411",
    walletAddress: "So11111111111111111111111111111111111111112",
    solanaAddress: "So11111111111111111111111111111111111111112",
    mnemonic: "test mnemonic never printed",
    close: async () => {},
  };
}

function baseDeps(overrides: Partial<RunDeps> = {}): RunDeps {
  const written: Record<string, string> = {};
  return {
    detect: () => ({ surface: "unknown" }),
    startProxy: async () => mockHandle(),
    runFreeCanary: async () => ({ model: "free/gpt-oss-120b", ok: true, status: 200 }),
    runPaidCanary: async () => ({ model: "deepseek/deepseek-chat", usdc: 0.001, ok: "ok", receipt: "" }),
    listSignatures: async () => ["oldSig"],
    findReceipt: async () => "Sig1111111111111111111111111111111111111111111111111111111111111111",
    writeProfile: (path, yaml) => {
      written[path] = yaml;
    },
    persistWallet: (path, contents) => {
      written[path] = contents;
    },
    cwd: "/tmp",
    env: {},
    now: () => new Date("2026-09-01T06:00:00.000Z"),
    ...overrides,
    // expose for assertions
    // @ts-expect-error test helper
    written,
  };
}

describe("runMigrate", () => {
  it("writes a profile after a free canary", async () => {
    const deps = baseDeps();
    const result = await runMigrate(parseArgs([]), deps);
    expect(result.free).toBe("ok");
    expect(result.paid).toBe("skip");
    expect(result.profile).toBe("/tmp/migrated-2026-09-01T06-00-00-000Z.profile.yaml");
    expect(result.rewrite).toContain("apiKey: \"x402\"");
  });

  it("fails closed when free canary fails", async () => {
    const deps = baseDeps({
      runFreeCanary: async () => ({ model: "free/gpt-oss-120b", ok: false, status: 402 }),
    });
    const result = await runMigrate(parseArgs([]), deps);
    expect(result.free).toBe("fail");
    expect(result.profile).toBe("");
  });

  it("skips paid when no wallet is configured", async () => {
    const deps = baseDeps();
    const result = await runMigrate(parseArgs(["--paid"]), deps);
    expect(result.free).toBe("ok");
    expect(result.paid).toBe("skip");
  });

  it("records a paid receipt from the explorer helper", async () => {
    let seenBefore: string[] | undefined;
    const deps = baseDeps({
      env: { SOLANA_WALLET_KEY: "aa".repeat(32) },
      listSignatures: async () => ["alreadyOnChain"],
      findReceipt: async (input) => {
        seenBefore = input.before;
        if (input.before.includes("alreadyOnChain")) {
          return "newCanarySig";
        }
        return undefined;
      },
    });
    const result = await runMigrate(parseArgs(["--paid", "--ceiling", "0.05"]), deps);
    expect(result.paid).toBe("ok");
    expect(seenBefore).toEqual(["alreadyOnChain"]);
    expect(result.receipt).toBe("https://solscan.io/tx/newCanarySig");
  });

  it("does not persist a generated mnemonic when a paid wallet was supplied", async () => {
    const written: Record<string, string> = {};
    const deps = baseDeps({
      env: { SOLANA_WALLET_KEY: "aa".repeat(32) },
      persistWallet: (path, contents) => {
        written[path] = contents;
      },
    });
    await runMigrate(parseArgs(["--paid", "--persist-wallet"]), deps);
    expect(Object.keys(written)).toEqual([]);
  });

  it("persists the ephemeral mnemonic only when no paid wallet was supplied", async () => {
    const written: Record<string, string> = {};
    const deps = baseDeps({
      persistWallet: (path, contents) => {
        written[path] = contents;
      },
    });
    await runMigrate(parseArgs(["--persist-wallet"]), deps);
    expect(Object.keys(written)).toHaveLength(1);
    expect(Object.values(written)[0]).toContain("test mnemonic never printed");
  });

  it("does not attach a receipt when the before-snapshot RPC fails", async () => {
    let receiptCalls = 0;
    const deps = baseDeps({
      env: { SOLANA_WALLET_KEY: "aa".repeat(32) },
      listSignatures: async () => null,
      findReceipt: async () => {
        receiptCalls += 1;
        return "shouldNotUse";
      },
    });
    const result = await runMigrate(parseArgs(["--paid"]), deps);
    expect(result.paid).toBe("ok");
    expect(result.receipt).toBe("");
    expect(receiptCalls).toBe(0);
  });

  it("leaves the isolated proxy open on --keep-running after success", async () => {
    let closed = false;
    const deps = baseDeps({
      startProxy: async () => ({
        ...mockHandle(),
        close: async () => {
          closed = true;
        },
      }),
    });
    const result = await runMigrate(parseArgs(["--keep-running"]), deps);
    expect(result.keepRunning).toBe(true);
    expect(closed).toBe(false);
  });

  it("closes the proxy on --keep-running when the free canary fails", async () => {
    let closed = false;
    const deps = baseDeps({
      startProxy: async () => ({
        ...mockHandle(),
        close: async () => {
          closed = true;
        },
      }),
      runFreeCanary: async () => ({ model: "free/gpt-oss-120b", ok: false, status: 402 }),
    });
    const result = await runMigrate(parseArgs(["--keep-running"]), deps);
    expect(result.keepRunning).toBe(false);
    expect(result.free).toBe("fail");
    expect(closed).toBe(true);
  });

  it("fails when the paid canary fails", async () => {
    const deps = baseDeps({
      env: { SOLANA_WALLET_KEY: "aa".repeat(32) },
      runPaidCanary: async () => ({
        model: "deepseek/deepseek-chat",
        usdc: 0,
        ok: "fail",
        receipt: "",
        reason: "HTTP 500",
      }),
    });
    const result = await runMigrate(parseArgs(["--paid"]), deps);
    expect(result.paid).toBe("fail");
    expect(result.profile).toBe("");
  });
});

describe("paid amount attribution", () => {
  it("flags an ok paid canary whose amount never parsed", async () => {
    const deps = baseDeps({
      env: { SOLANA_WALLET_KEY: "aa".repeat(32) },
      runPaidCanary: async () => ({ model: "deepseek/deepseek-chat", usdc: 0, ok: "ok", receipt: "" }),
      findReceipt: async () => undefined,
    });
    const result = await runMigrate(parseArgs(["--paid"]), deps);
    expect(result.paid).toBe("ok");
    expect(result.paidUsdcKnown).toBe(false);
    expect(result.receipt).toBe("");
    // @ts-expect-error test helper
    const yaml = Object.values(deps.written as Record<string, string>).join("\n");
    expect(yaml).toContain("usdc: unknown");
    expect(humanBlock(result)).toContain("spend is unverified");
  });

  it("leaves the flag true when the amount is known", async () => {
    const deps = baseDeps({ env: { SOLANA_WALLET_KEY: "aa".repeat(32) } });
    const result = await runMigrate(parseArgs(["--paid"]), deps);
    expect(result.paidUsdcKnown).toBe(true);
    expect(humanBlock(result)).not.toContain("spend is unverified");
  });
});

describe("persist-wallet write", () => {
  it("refuses to overwrite an existing wallet path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clawrouter-wallet-test-"));
    const deps = baseDeps({ cwd: dir, persistWallet: undefined });
    try {
      const name = "migrated-2026-09-01T06-00-00-000Z.wallet.json";
      writeFileSync(join(dir, name), "pre-existing", { mode: 0o644 });
      await expect(runMigrate(parseArgs(["--persist-wallet"]), deps)).rejects.toThrow(/EEXIST/);
      expect(readFileSync(join(dir, name), "utf8")).toBe("pre-existing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the mnemonic 0600 when the path is free", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clawrouter-wallet-test-"));
    const deps = baseDeps({ cwd: dir, persistWallet: undefined });
    try {
      const result = await runMigrate(parseArgs(["--persist-wallet"]), deps);
      expect(result.free).toBe("ok");
      const walletPath = join(dir, "migrated-2026-09-01T06-00-00-000Z.wallet.json");
      expect(statSync(walletPath).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
