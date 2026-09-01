import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { assertPortAvailable } from "../src/port.js";

function listen(port?: number): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(port ?? 0, "127.0.0.1", () => {
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

describe("assertPortAvailable", () => {
  it("refuses a port that already has a listener", async () => {
    const held = await listen();
    try {
      await expect(assertPortAvailable(held.port)).rejects.toThrow(/already in use/);
    } finally {
      await held.close();
    }
  });

  it("allows a port that is free", async () => {
    const held = await listen();
    const port = held.port;
    await held.close();
    await expect(assertPortAvailable(port)).resolves.toBeUndefined();
  });
});
