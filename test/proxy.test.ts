import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { ROUTE_BLOCKED_BODY } from "../src/allowlist.js";
import { findFreePort } from "../src/port.js";
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

  it("advertises an allowlist gate; partner paths 403 without hitting upstream", async () => {
    const hits: string[] = [];
    const advertised = await findFreePort();
    const handle = await startIsolatedProxy(
      { port: advertised, ceiling: 0.05, paid: false, persistWallet: false },
      {
        startUpstream: async ({ port }) => {
          const server = createHttpServer((req, res) => {
            hits.push(`${req.method ?? "GET"} ${req.url ?? "/"}`);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, path: req.url }));
          });
          await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(port, "127.0.0.1", () => resolve());
          });
          return {
            port,
            baseUrl: `http://127.0.0.1:${port}`,
            walletAddress: "So11111111111111111111111111111111111111112",
            close: () =>
              new Promise<void>((done, fail) => {
                server.close((err) => (err ? fail(err) : done()));
                server.closeAllConnections();
              }),
          };
        },
      },
    );

    try {
      expect(handle.port).toBe(advertised);
      expect(handle.baseUrl).toBe(`http://127.0.0.1:${advertised}`);

      const models = await fetch(`${handle.baseUrl}/v1/models`);
      expect(models.status).toBe(200);
      await expect(models.json()).resolves.toEqual({ ok: true, path: "/v1/models" });

      const blocked = await fetch(`${handle.baseUrl}/v1/partner/settle`, { method: "POST" });
      expect(blocked.status).toBe(403);
      await expect(blocked.json()).resolves.toEqual(ROUTE_BLOCKED_BODY);
      expect(hits).toEqual(["GET /v1/models"]);
    } finally {
      await handle.close();
    }
    await expect(fetch(`${handle.baseUrl}/v1/models`)).rejects.toThrow();
  });
});

describe("HOME isolation", () => {
  it("unsets HOME again when it started unset, instead of leaving \"undefined\"", async () => {
    const prev = process.env.HOME;
    delete process.env.HOME;
    try {
      const handle = await startIsolatedProxy(
        { ceiling: 0.05, paid: false, persistWallet: false },
        {
          startUpstream: async ({ port }) => ({
            port,
            baseUrl: `http://127.0.0.1:${port}`,
            walletAddress: "So11111111111111111111111111111111111111112",
            close: async () => {},
          }),
        },
      );
      expect(process.env.HOME).toBeDefined();
      await handle.close();
      expect("HOME" in process.env).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.HOME;
      else process.env.HOME = prev;
    }
  });
});
