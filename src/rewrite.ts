import type { Surface } from "./types.js";

export function rewriteSnippet(surface: Surface, port: number): string {
  const base = `http://127.0.0.1:${port}/v1`;
  const sdk = `baseURL: "${base}",
apiKey: "x402"`;

  if (surface === "openclaw") {
    return `Point the OpenClaw / BlockRun agent at the local proxy:

${sdk}

Then restart the agent so it uses ${base}.`;
  }

  if (surface === "unknown") {
    return `OpenAI-compatible clients:

${sdk}

Start the proxy with --keep-running, or run \`npx @blockrun/clawrouter\` on an isolated port.`;
  }

  return `Replace the ${surface === "openrouter" ? "OpenRouter" : "OpenAI"} client config with:

${sdk}

Do not upload the previous API key. ClawRouter signs x402 locally.`;
}
