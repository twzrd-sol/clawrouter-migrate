import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { startIsolatedProxy } from "../src/proxy.js";

function listen(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("failed to bind"));
        return;
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}

describe("startIsolatedProxy", () => {
  it("refuses a port that already has a listener instead of attaching to it", async () => {
    const held = await listen();
    try {
      await expect(
        startIsolatedProxy({ port: held.port, ceiling: 0.05, paid: false, persistWallet: false }),
      ).rejects.toThrow(/already in use/);
    } finally {
      await held.close();
    }
  });
});
