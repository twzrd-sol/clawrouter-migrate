import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";

describe("parseArgs", () => {
  it("defaults to free-only with 0.05 ceiling", () => {
    expect(parseArgs([])).toMatchObject({
      paid: false,
      ceiling: 0.05,
      keepRunning: false,
      persistWallet: false,
      json: false,
    });
  });

  it("parses paid flags", () => {
    expect(parseArgs(["--paid", "--ceiling", "0.02", "--wallet-file", "./k.json", "--json"])).toMatchObject({
      paid: true,
      ceiling: 0.02,
      walletFile: "./k.json",
      json: true,
    });
  });

  it("rejects production port 8402", () => {
    expect(() => parseArgs(["--port", "8402"])).toThrow(/8402/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--explode"])).toThrow(/unknown argument/);
  });
});
