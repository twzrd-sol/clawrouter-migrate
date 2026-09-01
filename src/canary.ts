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

export async function findLatestSignature(solanaAddress: string): Promise<string | undefined> {
  const res = await fetch("https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [solanaAddress, { limit: 1 }],
    }),
  });
  const data = (await res.json()) as { result?: Array<{ signature?: string }> };
  return data.result?.[0]?.signature;
}

export function solscanUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}
