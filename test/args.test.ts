import { describe, expect, it } from "vitest";
import { parseArgs, shouldExitProcess } from "../src/args.js";

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

describe("shouldExitProcess", () => {
  it("stays alive after a successful --keep-running canary", () => {
    expect(shouldExitProcess({ keepRunning: true, code: 0 })).toBe(false);
  });

  it("exits on failure even with --keep-running", () => {
    expect(shouldExitProcess({ keepRunning: true, code: 1 })).toBe(true);
  });

  it("exits on the default close path", () => {
    expect(shouldExitProcess({ keepRunning: false, code: 0 })).toBe(true);
  });
});
