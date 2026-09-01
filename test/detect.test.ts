import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectSurface } from "../src/detect.js";

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
