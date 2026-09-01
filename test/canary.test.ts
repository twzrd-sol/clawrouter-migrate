import { describe, expect, it } from "vitest";
import { findCanarySignature, parseSignedPaymentLog, runFreeCanary, runPaidCanary } from "../src/canary.js";
import { sessionCap } from "../src/proxy.js";
import { loadSolanaSeed } from "../src/wallet.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("runFreeCanary", () => {
  it("passes on free model HTTP 200", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/models")) {
        return jsonResponse(200, { data: [{ id: "free/gpt-oss-120b" }, { id: "deepseek/deepseek-chat" }] });
      }
      return jsonResponse(200, { choices: [{ message: { content: "migrate-free-ok" } }] });
    };
    const result = await runFreeCanary("http://127.0.0.1:8411", fetchImpl);
    expect(result).toEqual({ model: "free/gpt-oss-120b", ok: true, status: 200 });
  });

  it("fails on 402", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/models")) {
        return jsonResponse(200, { data: [{ id: "free/gpt-oss-120b" }] });
      }
      return jsonResponse(402, { error: "payment required" });
    };
    const result = await runFreeCanary("http://127.0.0.1:8411", fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(402);
  });
});

describe("runPaidCanary", () => {
  it("ok on HTTP 200", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse(200, { choices: [] });
    await expect(runPaidCanary("http://127.0.0.1:8411", "deepseek/deepseek-chat", fetchImpl)).resolves.toMatchObject({
      ok: "ok",
    });
  });

  it("skips unfunded 402", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse(402, { error: { message: "insufficient funds" } });
    await expect(runPaidCanary("http://127.0.0.1:8411", "deepseek/deepseek-chat", fetchImpl)).resolves.toMatchObject({
      ok: "skip",
    });
  });

  it("fails other errors", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse(500, { error: "boom" });
    await expect(runPaidCanary("http://127.0.0.1:8411", "deepseek/deepseek-chat", fetchImpl)).resolves.toMatchObject({
      ok: "fail",
    });
  });
});

describe("parseSignedPaymentLog", () => {
  it("reads the signed USD amount", () => {
    expect(
      parseSignedPaymentLog(
        "[ClawRouter] Payment signed on Solana (solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d) — $0.001000",
      ),
    ).toBe(0.001);
  });
});

describe("findCanarySignature", () => {
  it("returns only a signature that appeared after the snapshot", async () => {
    const calls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      calls.push(body.method ?? "");
      if (body.method === "getSignaturesForAddress") {
        return jsonResponse(200, {
          result: [{ signature: "newSig" }, { signature: "oldSig" }],
        });
      }
      return jsonResponse(200, { result: null });
    }) as typeof fetch;
    try {
      await expect(
        findCanarySignature({ solanaAddress: "So11111111111111111111111111111111111111112", before: ["oldSig"] }),
      ).resolves.toBe("newSig");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("returns undefined when the only signatures predate the canary", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse(200, { result: [{ signature: "oldSig" }] })) as typeof fetch;
    try {
      await expect(
        findCanarySignature({ solanaAddress: "So11111111111111111111111111111111111111112", before: ["oldSig"] }),
      ).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("sessionCap", () => {
  it("raises a $0.001 ceiling so the estimator can clear", () => {
    expect(sessionCap(0.001)).toBe(0.002);
    expect(sessionCap(0.05)).toBe(0.05);
  });
});

describe("loadSolanaSeed", () => {
  it("takes the first 32 bytes of a 64-byte keypair JSON", () => {
    const secret = Array.from({ length: 64 }, (_, i) => i);
    const file = join(tmpdir(), `migrate-wallet-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(secret));
    const seed = loadSolanaSeed({ walletFile: file });
    expect(seed).toHaveLength(32);
    expect(Array.from(seed!)).toEqual(secret.slice(0, 32));
  });

  it("reads hex from SOLANA_WALLET_KEY", () => {
    const seed = loadSolanaSeed({
      env: { SOLANA_WALLET_KEY: "11".repeat(32) },
    });
    expect(seed).toHaveLength(32);
    expect(seed![0]).toBe(0x11);
  });
});
