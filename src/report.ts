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
    `  receipt:  ${result.receipt || "-"}`,
    `  profile:  ${result.profile || "-"}`,
  ];
  if (result.keepRunning) {
    lines.push("  proxy left running (--keep-running)");
  }
  return lines.join("\n");
}
