import { createServer } from "node:net";

export const PRODUCTION_PROXY_PORT = 8402;

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
