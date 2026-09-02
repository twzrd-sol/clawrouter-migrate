import { describe, expect, it } from "vitest";
import { profileFilename, renderProfile } from "../src/profile.js";
import { rewriteSnippet } from "../src/rewrite.js";
import { errorOutput, machineLine } from "../src/report.js";

describe("renderProfile", () => {
  it("writes the v0 seed schema", () => {
    const yaml = renderProfile({
      surface: "openrouter",
      port: 8411,
      maxCostPerRequest: 0.05,
      maxCostPerSession: 0.05,
      free: { model: "free/gpt-oss-120b", ok: true },
      paid: { model: "deepseek/deepseek-chat", usdc: 0.001, ok: "skip" },
      rollbackBaseUrl: "https://openrouter.ai/api/v1",
    });
    expect(yaml).toContain("schema: clawrouter-profile/0.1");
    expect(yaml).toContain("source: openrouter");
    expect(yaml).toContain("port: 8411");
    expect(yaml).toContain("partners: false");
    expect(yaml).toContain("allowed_routes:");
    expect(yaml).toContain("    - /v1/models");
    expect(yaml).toContain("    - /v1/chat/completions");
    expect(yaml).toContain("free: { model: free/gpt-oss-120b, ok: true }");
    expect(yaml).toContain("ok: skip");
    expect(yaml).toContain('openai_base_url: "https://openrouter.ai/api/v1"');
  });

  it("renders an unparsed paid amount as unknown, not $0", () => {
    const yaml = renderProfile({
      surface: "openai",
      port: 8411,
      maxCostPerRequest: 0.05,
      maxCostPerSession: 0.05,
      free: { model: "free/gpt-oss-120b", ok: true },
      paid: { model: "deepseek/deepseek-chat", usdc: 0, ok: "ok", usdcKnown: false },
    });
    expect(yaml).toContain("usdc: unknown");
    expect(yaml).not.toContain("usdc: 0,");
  });

  it("names files from the timestamp", () => {
    expect(profileFilename(new Date("2026-09-01T06:00:00.000Z"))).toBe(
      "migrated-2026-09-01T06-00-00-000Z.profile.yaml",
    );
  });
});

describe("rewriteSnippet", () => {
  it("uses dummy apiKey x402", () => {
    expect(rewriteSnippet("openai", 8411)).toContain('apiKey: "x402"');
    expect(rewriteSnippet("openai", 8411)).toContain("http://127.0.0.1:8411/v1");
  });
});

describe("machineLine", () => {
  it("matches the canary contract", () => {
    const line = machineLine({
      surface: "unknown",
      proxy: "http://127.0.0.1:8411",
      wallet: "So11111111111111111111111111111111111111112",
      ceiling: 0.05,
      free: "ok",
      paid: "skip",
      receipt: "",
      profile: "/tmp/p.yaml",
      rewrite: "",
      keepRunning: false,
    });
    expect(line).toBe(
      "unknown | http://127.0.0.1:8411 | So11111111111111111111111111111111111111112 | 0.05 | free: ok | paid: skip | - | /tmp/p.yaml",
    );
  });
});

describe("errorOutput", () => {
  it("puts a JSON object on stdout under --json and plain text on stderr otherwise", () => {
    const err = new Error("port 8402 is already in use");
    expect(errorOutput(err, true)).toEqual({ stdout: JSON.stringify({ error: "port 8402 is already in use" }) });
    expect(errorOutput(err, false)).toEqual({ stderr: "port 8402 is already in use" });
    expect(errorOutput("plain string", true).stdout).toBe(JSON.stringify({ error: "plain string" }));
  });
});

