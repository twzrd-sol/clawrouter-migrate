import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectSurface } from "../src/detect.js";
import { loadSolanaSeed } from "../src/wallet.js";

describe("detectSurface", () => {
  it("prefers OpenRouter env", () => {
    expect(
      detectSurface({
        env: { OPENROUTER_API_KEY: "sk-or-test", OPENAI_API_KEY: "sk-openai" },
        homedir: "/no/home",
      }),
    ).toEqual({ surface: "openrouter", rollbackBaseUrl: undefined });
  });

  it("uses OpenRouter base URL even without a key", () => {
    expect(
      detectSurface({
        env: { OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1" },
        homedir: "/no/home",
      }),
    ).toEqual({
      surface: "openrouter",
      rollbackBaseUrl: "https://openrouter.ai/api/v1",
    });
  });

  it("detects OpenAI when OpenRouter is absent", () => {
    expect(
      detectSurface({
        env: { OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "https://api.openai.com/v1" },
        homedir: "/no/home",
      }),
    ).toEqual({
      surface: "openai",
      rollbackBaseUrl: "https://api.openai.com/v1",
    });
  });

  it("detects OpenClaw from homedir", () => {
    const home = mkdtempSync(join(tmpdir(), "migrate-detect-"));
    mkdirSync(join(home, ".openclaw"));
    expect(detectSurface({ env: {}, homedir: home })).toEqual({ surface: "openclaw" });
  });

  it("falls back to unknown", () => {
    expect(detectSurface({ env: {}, homedir: "/no/home" })).toEqual({ surface: "unknown" });
  });
});

describe("loadSolanaSeed byte range", () => {
  it("rejects integers outside 0-255 instead of wrapping them", () => {
    expect(() =>
      loadSolanaSeed({ env: { SOLANA_WALLET_KEY: JSON.stringify([256, ...Array(31).fill(1)]) } }),
    ).toThrow(/0-255/);
    expect(() =>
      loadSolanaSeed({ env: { SOLANA_WALLET_KEY: JSON.stringify([-1, ...Array(31).fill(1)]) } }),
    ).toThrow(/0-255/);
  });
});
