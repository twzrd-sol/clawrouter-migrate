import { existsSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import { join } from "node:path";
import type { DetectResult } from "./types.js";

export function detectSurface(input: { env?: NodeJS.ProcessEnv; homedir?: string } = {}): DetectResult {
  const env = input.env ?? process.env;
  const home = input.homedir ?? osHomedir();

  if (env.OPENROUTER_API_KEY || env.OPENROUTER_BASE_URL) {
    return {
      surface: "openrouter",
      rollbackBaseUrl: env.OPENROUTER_BASE_URL,
    };
  }

  if (env.OPENAI_BASE_URL || env.OPENAI_API_KEY) {
    return {
      surface: "openai",
      rollbackBaseUrl: env.OPENAI_BASE_URL,
    };
  }

  if (existsSync(join(home, ".openclaw"))) {
    return { surface: "openclaw" };
  }

  return { surface: "unknown" };
}
