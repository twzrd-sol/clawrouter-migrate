import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_ROUTES,
  isAllowedRoute,
  requestPathname,
  ROUTE_BLOCKED_BODY,
  startAllowlistGate,
} from "../src/allowlist.js";

/** fetch()/WHATWG URL collapse `%2e` before the request; http.request keeps the raw target. */
function rawRequest(
  baseUrl: string,
  path: string,
  method = "GET",
): Promise<{ status: number; json: unknown }> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, path, method },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            json: text ? JSON.parse(text) : null,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ port: number; url: string; close: () => Promise<void>; hits: string[] }> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method ?? "GET"} ${req.url ?? "/"}`);
    handler(req, res);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("failed to bind"));
        return;
      }
      resolve({
        port: addr.port,
        url: `http://127.0.0.1:${addr.port}`,
        hits,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
            server.closeAllConnections();
          }),
      });
    });
    server.on("error", reject);
  });
}

describe("requestPathname", () => {
  it("collapses decoded separators so encoded slash-dot-dot cannot stay under /v1/models/", () => {
    expect(requestPathname("/v1/models%2f../partner/settle")).toBe("/v1/partner/settle");
    expect(requestPathname("/v1/models/%252e%252e/partner/settle")).toBe("/v1/partner/settle");
    expect(requestPathname("/v1/models%5c..%5cpartner")).toBe("/v1/partner");
    expect(requestPathname("/v1/models?foo=1")).toBe("/v1/models");
    expect(requestPathname("/v1/%6d%6f%64%65%6c%73")).toBe("/v1/models");
  });
});

describe("isAllowedRoute", () => {
  it("allows the OpenAI canary and common client paths", () => {
    expect(ALLOWED_ROUTES).toEqual([
      "/v1/models",
      "/v1/chat/completions",
      "/v1/completions",
      "/v1/embeddings",
    ]);
    for (const route of ALLOWED_ROUTES) {
      expect(isAllowedRoute(route)).toBe(true);
      expect(isAllowedRoute(`${route}/`)).toBe(true);
      expect(isAllowedRoute(`${route}?foo=1`)).toBe(true);
    }
    expect(isAllowedRoute("/v1/models/free/gpt-oss-120b")).toBe(true);
    expect(isAllowedRoute("/v1/models/deepseek-deepseek-chat")).toBe(true);
  });

  it("blocks partner, phone, media, and other settlement surfaces", () => {
    const blocked = [
      "/v1/partner/settle",
      "/v1/pm/order",
      "/v1/exa/search",
      "/v1/modal/run",
      "/v1/stocks/quote",
      "/v1/usstock/quote",
      "/v1/crypto/price",
      "/v1/fx/rate",
      "/v1/commodity/gold",
      "/v1/phone/call",
      "/v1/voice/tts",
      "/v1/surf/browse",
      "/v1/image/generate",
      "/v1/music/compose",
      "/v1/speech/transcribe",
      "/v1/video/render",
      "/v1/defi/swap",
      "/v1/rpc",
      "/v1/dex/quote",
      "/v1/markets",
      "/v1/price",
      "/v1/search",
      "/v1/realface",
      "/v1/polymarket",
      "/health",
      "/v1/chat/completions/../partner/x",
    ];
    for (const route of blocked) {
      expect(isAllowedRoute(route), route).toBe(false);
    }
  });

  it("rejects percent-encoded dots and separators that rematerialize as traversal", () => {
    const encoded = [
      "/v1/models/%2e%2e/partner/settle",
      "/v1/models/%2E%2E/partner/settle",
      "/v1/models/%2e",
      "/v1/models/%2E",
      "/v1/%2e%2e/v1/models",
      "/%2e%2e/v1/models",
      "/v1/models%2f../partner/settle",
      "/v1/models%2Fextra",
      "/v1/%2fpartner/settle",
      "/v1/chat%2fcompletions",
      "/v1/partner%2fsettle",
      "/v1/models/%2e%2e/%2e%2e/v1/partner/x",
      "/v1/models%5c..%5cpartner",
      "/v1/models/%252e%252e/partner/settle",
      "/v1/models/%252E",
      "/v1/models/%0d%0aX",
    ];
    for (const route of encoded) {
      expect(isAllowedRoute(route), route).toBe(false);
    }
  });
});

describe("startAllowlistGate", () => {
  it("forwards allowlisted canary paths and never sends partner paths upstream", async () => {
    const upstream = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            path: req.url,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      });
    });

    const gate = await startAllowlistGate({ listenPort: 0, upstreamPort: upstream.port });
    try {
      const models = await fetch(`${gate.baseUrl}/v1/models`);
      expect(models.status).toBe(200);
      await expect(models.json()).resolves.toMatchObject({ ok: true, path: "/v1/models" });

      const chat = await fetch(`${gate.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "free/gpt-oss-120b", messages: [] }),
      });
      expect(chat.status).toBe(200);
      await expect(chat.json()).resolves.toMatchObject({
        ok: true,
        path: "/v1/chat/completions",
        body: JSON.stringify({ model: "free/gpt-oss-120b", messages: [] }),
      });

      const beforeHits = [...upstream.hits];
      for (const path of ["/v1/partner/settle", "/v1/phone/call", "/v1/modal/run"]) {
        const blocked = await fetch(`${gate.baseUrl}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ should: "not-reach-upstream" }),
        });
        expect(blocked.status).toBe(403);
        await expect(blocked.json()).resolves.toEqual(ROUTE_BLOCKED_BODY);
      }
      expect(upstream.hits).toEqual(beforeHits);
      expect(upstream.hits.some((h) => h.includes("/v1/partner"))).toBe(false);
    } finally {
      await gate.close();
      await upstream.close();
    }
  });

  it("rejects encoded traversal against /v1/models and partner-looking paths", async () => {
    const upstream = await listen((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    const gate = await startAllowlistGate({ listenPort: 0, upstreamPort: upstream.port });
    try {
      const attempts = [
        "/v1/models/%2e%2e/partner/settle",
        "/v1/models/%2E%2E/partner/settle",
        "/v1/models/%2e",
        "/v1/models/%2E",
        "/v1/%2e%2e/v1/models",
        "/%2e%2e/v1/models",
        "/v1/models%2f../partner/settle",
        "/v1/models%2Fextra",
        "/v1/%2fpartner/settle",
        "/v1/chat%2fcompletions",
        "/v1/partner%2fsettle",
        "/v1/models/%252e%252e/partner/settle",
        "/v1/models/%252E",
        "/v1/models%5c..%5cpartner",
        "/v1/models/%0d%0aX",
      ];
      const beforeHits = [...upstream.hits];
      for (const path of attempts) {
        const blocked = await rawRequest(gate.baseUrl, path);
        expect(blocked.status, path).toBe(403);
        expect(blocked.json).toEqual(ROUTE_BLOCKED_BODY);
      }
      expect(upstream.hits).toEqual(beforeHits);
    } finally {
      await gate.close();
      await upstream.close();
    }
  });

  it("forwards the canonical pathname plus the original query string", async () => {
    const upstream = await listen((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    const gate = await startAllowlistGate({ listenPort: 0, upstreamPort: upstream.port });
    try {
      const withQuery = await fetch(`${gate.baseUrl}/v1/models?foo=1`);
      expect(withQuery.status).toBe(200);
      await expect(withQuery.json()).resolves.toEqual({ ok: true, path: "/v1/models?foo=1" });

      const trailing = await fetch(`${gate.baseUrl}/v1/models/`);
      expect(trailing.status).toBe(200);
      await expect(trailing.json()).resolves.toEqual({ ok: true, path: "/v1/models" });

      const encodedLetters = await rawRequest(gate.baseUrl, "/v1/%6d%6f%64%65%6c%73");
      expect(encodedLetters.status).toBe(200);
      expect(encodedLetters.json).toEqual({ ok: true, path: "/v1/models" });

      expect(upstream.hits).toEqual([
        "GET /v1/models?foo=1",
        "GET /v1/models",
        "GET /v1/models",
      ]);
    } finally {
      await gate.close();
      await upstream.close();
    }
  });
});
