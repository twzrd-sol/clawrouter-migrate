import { describe, expect, it } from "vitest";
import { withConsoleCapture, withStdoutQuiet } from "../src/logs.js";

describe("withStdoutQuiet", () => {
  it("routes console.log to stderr for the duration and restores it after", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => out.push(a.join(" "));
    console.error = (...a: unknown[]) => err.push(a.join(" "));
    try {
      const value = await withStdoutQuiet(async () => {
        console.log("[ClawRouter] Solana wallet: abc");
        return 42;
      });
      console.log("after");
      expect(value).toBe(42);
      expect(out).toEqual(["after"]);
      expect(err).toEqual(["[ClawRouter] Solana wallet: abc"]);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  });

  it("still lets withConsoleCapture parse the signed-payment line while quiet", async () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      const { lines } = await withStdoutQuiet(() =>
        withConsoleCapture(async () => {
          console.log("[ClawRouter] Payment signed on solana — $0.001000");
        }),
      );
      expect(lines).toEqual(["[ClawRouter] Payment signed on solana — $0.001000"]);
    } finally {
      console.error = origErr;
    }
  });
});
