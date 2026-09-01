import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

/**
 * OpenAI-compatible paths the isolated migrate proxy will forward.
 * Canary uses `/v1/models` + `/v1/chat/completions`; completions/embeddings
 * are included for common OpenAI clients pointed at the rewrite snippet.
 *
 * Everything else — including upstream partner surfaces matching
 * `/^\/v1\/(?:partner|pm|exa|modal|stocks|usstock|crypto|fx|commodity|phone|voice|surf)\//`
 * — is rejected at the gate and never reaches ClawRouter settlement.
 */
export const ALLOWED_ROUTES = [
  "/v1/models",
  "/v1/chat/completions",
  "/v1/completions",
  "/v1/embeddings",
] as const;

export const ROUTE_BLOCKED_BODY = {
  error: {
    message: "route blocked by migrator allowlist (partners: false)",
    type: "route_blocked",
  },
} as const;

const ALLOWED_EXACT = new Set<string>(ALLOWED_ROUTES);

export function requestPathname(rawUrl: string): string {
  const pathPart = rawUrl.split("?")[0] || "/";
  let pathname = pathPart;
  try {
    pathname = new URL(pathPart, "http://127.0.0.1").pathname;
  } catch {
    pathname = pathPart;
  }

  const parts: string[] = [];
  for (const seg of pathname.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    try {
      parts.push(decodeURIComponent(seg));
    } catch {
      parts.push(seg);
    }
  }
  return `/${parts.join("/")}`;
}

export function isAllowedRoute(rawUrl: string): boolean {
  const path = requestPathname(rawUrl);
  if (ALLOWED_EXACT.has(path)) return true;
  return path.startsWith("/v1/models/") && path.length > "/v1/models/".length;
}

export type AllowlistGate = {
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
};

export async function startAllowlistGate(opts: {
  listenPort: number;
  upstreamPort: number;
  host?: string;
}): Promise<AllowlistGate> {
  const host = opts.host ?? "127.0.0.1";
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handleGateRequest(req, res, opts.upstreamPort);
    });
    server.once("error", reject);
    server.listen(opts.listenPort, host, () => {
      server.removeListener("error", reject);
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("allowlist gate failed to bind"));
        return;
      }
      resolve({
        port: addr.port,
        baseUrl: `http://${host}:${addr.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
            server.closeAllConnections();
          }),
      });
    });
  });
}

function handleGateRequest(req: IncomingMessage, res: ServerResponse, upstreamPort: number): void {
  const raw = req.url ?? "/";
  if (!isAllowedRoute(raw)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify(ROUTE_BLOCKED_BODY));
    return;
  }

  const proxy = httpRequest(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
      path: raw,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  proxy.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "upstream unavailable", type: "bad_gateway" } }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxy);
}
