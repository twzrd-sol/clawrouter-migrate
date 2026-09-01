import type { FreeCanary, PaidCanary } from "./types.js";

export const PAID_CANARY_MODEL = "deepseek/deepseek-chat";

const FREE_PROMPT = "Reply with exactly: migrate-free-ok";
const PAID_PROMPT = "Reply with exactly: migrate-paid-ok";

export async function runFreeCanary(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<FreeCanary> {
  const modelsRes = await fetchImpl(`${baseUrl}/v1/models`);
  if (!modelsRes.ok) {
    return { model: "", ok: false, status: modelsRes.status };
  }
  const modelsBody = (await modelsRes.json()) as { data?: Array<{ id?: string }> };
  const model = (modelsBody.data ?? []).map((m) => m.id).find((id): id is string => Boolean(id?.startsWith("free/")));
  if (!model) {
    return { model: "", ok: false, status: modelsRes.status };
  }

  const chat = await postChat(baseUrl, model, FREE_PROMPT, fetchImpl);
  const paidChallenge = chat.status === 402;
  return {
    model,
    ok: chat.status === 200 && !paidChallenge,
    status: chat.status,
  };
}

export async function runPaidCanary(
  baseUrl: string,
  model: string = PAID_CANARY_MODEL,
  fetchImpl: typeof fetch = fetch,
): Promise<PaidCanary> {
  const chat = await postChat(baseUrl, model, PAID_PROMPT, fetchImpl);

  if (chat.status === 200) {
    return { model, usdc: 0, ok: "ok", receipt: "" };
  }

  if (isSkipStatus(chat.status, chat.body)) {
    return {
      model,
      usdc: 0,
      ok: "skip",
      receipt: "",
      reason: skipReason(chat.body) ?? `HTTP ${chat.status}`,
    };
  }

  return {
    model,
    usdc: 0,
    ok: "fail",
    receipt: "",
    reason: `HTTP ${chat.status}`,
  };
}

function isSkipStatus(status: number, body: unknown): boolean {
  if (status === 402) return true;
  if (status === 429) {
    const text = JSON.stringify(body).toLowerCase();
    return text.includes("insufficient") || text.includes("fund") || text.includes("balance");
  }
  return false;
}

function skipReason(body: unknown): string | undefined {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error?: { message?: string } | string }).error;
    if (typeof err === "string") return err;
    if (err?.message) return err.message;
  }
  return undefined;
}

async function postChat(
  baseUrl: string,
  model: string,
  content: string,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: unknown }> {
  const res = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer x402",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      max_tokens: 16,
    }),
  });
  let body: unknown = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

export function parseSignedPaymentLog(line: string): number | undefined {
  const match = line.match(/Payment signed on .+ — \$([0-9.]+)/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : undefined;
}

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RPC_URL = "https://api.mainnet-beta.solana.com";

async function solanaRpc<T>(method: string, params: unknown[]): Promise<T | undefined> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = (await res.json()) as { result?: T };
  return data.result;
}

/** `null` means the RPC call failed — never treat that as an empty snapshot. */
export async function listRecentSignatures(solanaAddress: string, limit = 8): Promise<string[] | null> {
  try {
    const result = await solanaRpc<Array<{ signature?: string }>>("getSignaturesForAddress", [
      solanaAddress,
      { limit },
    ]);
    if (!Array.isArray(result)) return null;
    return result.map((r) => r.signature).filter((s): s is string => Boolean(s));
  } catch {
    return null;
  }
}

type TokenBalance = {
  mint: string;
  owner?: string;
  uiTokenAmount?: { uiAmount?: number | null; uiAmountString?: string };
};

function usdcDebit(owner: string, pre: TokenBalance[] | undefined, post: TokenBalance[] | undefined): number | undefined {
  const read = (rows: TokenBalance[] | undefined) => {
    const row = (rows ?? []).find((b) => b.mint === USDC_MINT && b.owner === owner);
    if (!row) return undefined;
    const n = Number(row.uiTokenAmount?.uiAmountString ?? row.uiTokenAmount?.uiAmount);
    return Number.isFinite(n) ? n : undefined;
  };
  const before = read(pre);
  const after = read(post);
  if (before === undefined || after === undefined) return undefined;
  return before - after;
}

export async function signatureMatchesUsdc(signature: string, owner: string, amountUsd: number): Promise<boolean> {
  const tx = await solanaRpc<{
    meta?: { preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] };
  }>("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
  const debit = usdcDebit(owner, tx?.meta?.preTokenBalances, tx?.meta?.postTokenBalances);
  if (debit === undefined) return false;
  return Math.abs(debit - amountUsd) < 1e-6;
}

/** New signature after `before`, optionally confirmed by USDC debit. Never returns a pre-existing latest tx. */
export async function findCanarySignature(input: {
  solanaAddress: string;
  before: string[];
  amountUsd?: number;
}): Promise<string | undefined> {
  const after = await listRecentSignatures(input.solanaAddress);
  if (!after) return undefined;
  const newcomers = after.filter((sig) => !input.before.includes(sig));
  if (newcomers.length === 0) return undefined;
  const amount = input.amountUsd;
  if (amount === undefined || amount <= 0) return undefined;
  for (const sig of newcomers) {
    if (await signatureMatchesUsdc(sig, input.solanaAddress, amount)) return sig;
  }
  return undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll `findCanarySignature` — public RPC indexing can lag ~10s behind settlement,
 * so a single lookup right after the canary call reads a false zero.
 */
export async function pollCanarySignature(input: {
  solanaAddress: string;
  before: string[];
  amountUsd?: number;
  attempts?: number;
  delayMs?: number;
}): Promise<string | undefined> {
  const attempts = input.attempts ?? 6;
  const delayMs = input.delayMs ?? 2000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const sig = await findCanarySignature(input);
    if (sig) return sig;
    if (attempt < attempts - 1) await sleep(delayMs);
  }
  return undefined;
}

export function solscanUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}
