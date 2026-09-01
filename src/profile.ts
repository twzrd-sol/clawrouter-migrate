import { ALLOWED_ROUTES } from "./allowlist.js";
import type { CanaryFlag, Surface } from "./types.js";

export type ProfileInput = {
  surface: Surface;
  port: number;
  maxCostPerRequest: number;
  maxCostPerSession: number;
  free: { model: string; ok: boolean };
  paid: { model: string; usdc: number; ok: CanaryFlag };
  rollbackBaseUrl?: string;
};

function yamlScalar(value: string | number | boolean): string {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === "") return '""';
  if (/[:#\n]|^\s|\s$/.test(value)) return JSON.stringify(value);
  return value;
}

export function renderProfile(input: ProfileInput): string {
  const rollback = input.rollbackBaseUrl ?? "";
  return [
    "schema: clawrouter-profile/0.1",
    `source: ${yamlScalar(input.surface)}`,
    "proxy:",
    `  port: ${input.port}`,
    "policy:",
    `  maxCostPerRequest: ${input.maxCostPerRequest}`,
    `  maxCostPerSession: ${input.maxCostPerSession}`,
    "  partners: false",
    "  allowed_routes:",
    ...ALLOWED_ROUTES.map((route) => `    - ${route}`),
    "canary:",
    `  free: { model: ${yamlScalar(input.free.model)}, ok: ${input.free.ok} }`,
    `  paid: { model: ${yamlScalar(input.paid.model)}, usdc: ${input.paid.usdc}, ok: ${yamlScalar(input.paid.ok)} }`,
    "rollback:",
    `  openai_base_url: ${rollback ? yamlScalar(rollback) : '""'}`,
    "",
  ].join("\n");
}

export function profileFilename(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `migrated-${stamp}.profile.yaml`;
}
