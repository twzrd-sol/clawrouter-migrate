import { describe, expect, it } from "vitest";
import { redirectStdoutLogs, withConsoleCapture } from "../src/logs.js";

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a: unknown[]) => out.push(a.join(" "));
  console.error = (...a: unknown[]) => err.push(a.join(" "));
  return { out, err, restore: () => Object.assign(console, orig) };
}

describe("redirectStdoutLogs", () => {
  it("sends later console.log to stderr and returns the real stdout writer", () => {
    const c = captureConsole();
    try {
      const emit = redirectStdoutLogs();
      console.log("[ClawRouter] Solana wallet: abc"); // peer chatter
      emit('{"free":"ok"}'); // the one thing stdout is for
      console.log("[ClawRouter] Received model: free/x"); // --keep-running: logs after the result
      expect(c.out).toEqual(['{"free":"ok"}']);
      expect(c.err).toEqual(["[ClawRouter] Solana wallet: abc", "[ClawRouter] Received model: free/x"]);
    } finally {
      c.restore();
    }
  });

  it("still lets withConsoleCapture parse the signed-payment line", async () => {
    const c = captureConsole();
    try {
      redirectStdoutLogs();
      const { lines } = await withConsoleCapture(async () => {
        console.log("[ClawRouter] Payment signed on solana — $0.001000");
      });
      expect(lines).toEqual(["[ClawRouter] Payment signed on solana — $0.001000"]);
      expect(c.out).toEqual([]);
    } finally {
      c.restore();
    }
  });
});
