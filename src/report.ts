import type { MigrateResult } from "./types.js";

export function machineLine(result: MigrateResult): string {
  return [
    result.surface,
    result.proxy,
    result.wallet,
    String(result.ceiling),
    `free: ${result.free}`,
    `paid: ${result.paid}`,
    result.receipt || "-",
    result.profile || "-",
  ].join(" | ");
}

/** `--json` promises an object on stdout even when the run throws. */
export function errorOutput(err: unknown, json: boolean): { stdout?: string; stderr?: string } {
  const message = err instanceof Error ? err.message : String(err);
  return json ? { stdout: JSON.stringify({ error: message }) } : { stderr: message };
}

export function humanBlock(result: MigrateResult): string {
  const lines = [
    "ClawRouter migrate",
    `  surface:  ${result.surface}`,
    `  proxy:    ${result.proxy}`,
    `  wallet:   ${result.wallet}`,
    `  ceiling:  ${result.ceiling}`,
    ...(result.effectiveSessionCap !== undefined && result.effectiveSessionCap > result.ceiling
      ? [`  note:     session cap raised to $${result.effectiveSessionCap} (provider estimator minimum)`]
      : []),
    `  free:     ${result.free}${result.freeModel ? ` (${result.freeModel})` : ""}`,
    `  paid:     ${result.paid}${result.paidModel ? ` (${result.paidModel})` : ""}`,
    ...(result.paidUsdcKnown === false
      ? [
          "  warn:     paid call succeeded but no signed-payment amount was parsed;",
          "            spend is unverified and no receipt could be attributed",
        ]
      : []),
    `  receipt:  ${result.receipt || "-"}`,
    `  profile:  ${result.profile || "-"}`,
  ];
  if (result.keepRunning) {
    lines.push("  proxy left running (--keep-running)");
  }
  return lines.join("\n");
}
