export type Surface = "openrouter" | "openai" | "openclaw" | "unknown";

export type CanaryFlag = "ok" | "fail" | "skip";

export type CliArgs = {
  paid: boolean;
  ceiling: number;
  keepRunning: boolean;
  persistWallet: boolean;
  walletFile?: string;
  json: boolean;
  help: boolean;
  port?: number;
};

export type DetectResult = {
  surface: Surface;
  rollbackBaseUrl?: string;
};

export type FreeCanary = {
  model: string;
  ok: boolean;
  status?: number;
};

export type PaidCanary = {
  model: string;
  usdc: number;
  ok: CanaryFlag;
  receipt: string;
  reason?: string;
};

export type IsolatedHandle = {
  port: number;
  baseUrl: string;
  walletAddress: string;
  solanaAddress?: string;
  /** Ephemeral mnemonic, only when --persist-wallet and no supplied paid seed. Never print. */
  mnemonic?: string;
  close: () => Promise<void>;
};

export type MigrateResult = {
  surface: Surface;
  proxy: string;
  wallet: string;
  ceiling: number;
  /** Session cap actually enforced (may exceed ceiling to clear the provider estimator). */
  effectiveSessionCap?: number;
  free: CanaryFlag;
  paid: CanaryFlag;
  receipt: string;
  profile: string;
  freeModel?: string;
  paidModel?: string;
  paidUsdc?: number;
  /** False when a paid call succeeded but no signed-payment amount was parsed. */
  paidUsdcKnown?: boolean;
  rewrite: string;
  keepRunning: boolean;
};

export type RunDeps = {
  detect?: (input: { env?: NodeJS.ProcessEnv; homedir?: string }) => DetectResult;
  startProxy: (opts: StartIsolatedOpts) => Promise<IsolatedHandle>;
  runFreeCanary?: (baseUrl: string) => Promise<FreeCanary>;
  runPaidCanary?: (baseUrl: string, model?: string) => Promise<PaidCanary>;
  listSignatures?: (solanaAddress: string) => Promise<string[] | null>;
  findReceipt?: (input: {
    solanaAddress: string;
    before: string[];
    amountUsd?: number;
  }) => Promise<string | undefined>;
  writeProfile?: (path: string, yaml: string) => void;
  persistWallet?: (path: string, contents: string) => void;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  now?: () => Date;
};

export type StartIsolatedOpts = {
  port?: number;
  ceiling: number;
  paid: boolean;
  solanaPrivateKeyBytes?: Uint8Array;
  persistWallet: boolean;
};
