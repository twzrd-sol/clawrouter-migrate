export { parseArgs, HELP } from "./args.js";
export { detectSurface } from "./detect.js";
export { rewriteSnippet } from "./rewrite.js";
export { renderProfile, profileFilename } from "./profile.js";
export { loadSolanaSeed } from "./wallet.js";
export { findFreePort, PRODUCTION_PROXY_PORT } from "./port.js";
export {
  runFreeCanary,
  runPaidCanary,
  parseSignedPaymentLog,
  findCanarySignature,
  listRecentSignatures,
  PAID_CANARY_MODEL,
} from "./canary.js";
export { startIsolatedProxy, sessionCap } from "./proxy.js";
export { runMigrate, defaultDeps } from "./run.js";
export { machineLine, humanBlock } from "./report.js";
export type {
  Surface,
  CanaryFlag,
  CliArgs,
  DetectResult,
  FreeCanary,
  PaidCanary,
  IsolatedHandle,
  MigrateResult,
  RunDeps,
  StartIsolatedOpts,
} from "./types.js";
