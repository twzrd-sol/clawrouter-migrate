import { createServer } from "node:net";

export const PRODUCTION_PROXY_PORT = 8402;

/** Refuse to hand `--port` to startProxy when something is already bound (library would reuse it). */
export async function assertPortAvailable(port: number): Promise<void> {
  const taken = await new Promise<boolean>((resolve, reject) => {
    const server = createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") resolve(true);
      else reject(err);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close((err) => {
        if (err) reject(err);
        else resolve(false);
      });
    });
  });
  if (taken) {
    throw new Error(`port ${port} is already in use — refusing to attach to an existing listener`);
  }
}

export async function findFreePort(exclude: ReadonlySet<number> = new Set([PRODUCTION_PROXY_PORT])): Promise<number> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = await listenZero();
    if (!exclude.has(port)) return port;
  }
  throw new Error("could not find a free isolated port");
}

function listenZero(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("failed to bind ephemeral port"));
        return;
      }
      const port = addr.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}
