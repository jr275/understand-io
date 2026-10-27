import { randomUUID } from "node:crypto";
import { budgetLimits, costMicro, quotaFor, quotasOff, type Estimate, type QuotaBucket } from "@/lib/ai/budget";
import { SESSION_COOKIE } from "./auth";
import { aiStore, type AiStore, type Charge } from "./aiStore";
import { READER_COOKIE, verifyReaderCookie, verifyToken } from "./reader";
import { clientIp } from "./rateLimit";

/**
 * The gate in front of every AI request that spends the operator's key (and, for the one-at-a-time rule, in front of the readers' own keys too).
 * Order: the daily allowance of whoever is asking, then the lease that allows one generation at a time, then a reservation against the global
 * budget. Anything that fails after an earlier step undoes that step. When the allowances cannot be read, a request on the operator's key is
 * refused (spending must not go unmetered); a request on the reader's own key goes on, because it costs the operator nothing.
 */

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ who is asking */

export interface Client {
  /** Signed in: the account id. */
  accountId: string | null;
  /** The browser's reader id when it has a valid cookie, otherwise the network address. */
  clientKey: string;
  ip: string;
}

function cookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** A signed session cookie names an account; a signed reader cookie names a browser. Both signatures are checked here, nothing the client sends is taken on trust. */
export function identifyClient(req: Request): Client {
  const ip = clientIp(req);
  const accountId = verifyToken("session", cookieValue(req, SESSION_COOKIE));
  const reader = verifyReaderCookie(cookieValue(req, READER_COOKIE));
  return { accountId, clientKey: reader ?? `ip:${ip}`, ip };
}

/* ------------------------------------------------------------------ refusals */

const KEY_HINT = "add your own Together key with the key button in the top bar";

const secondsToUtcMidnight = (now: number) => Math.max(1, Math.ceil((Math.floor(now / DAY_MS) * DAY_MS + DAY_MS - now) / 1000));

function refuse(status: number, error: string, message: string, retryAfter: number): Response {
  return Response.json({ error, message }, { status, headers: { "retry-after": String(retryAfter), "cache-control": "no-store" } });
}

type Scope = "user" | "anon" | "ip" | "global";

function quotaRefusal(scope: Scope, bucket: QuotaBucket, now: number): Response {
  const q = quotaFor(bucket);
  const what = bucket === "ai" ? "AI questions" : bucket === "search" ? "searches by meaning" : "voice transcriptions";
  const wait = secondsToUtcMidnight(now);
  if (scope === "user") return refuse(429, "quota", `You have used today's ${q.user} ${what}. The allowance renews at midnight UTC, or ${KEY_HINT}.`, wait);
  if (scope === "anon") return refuse(429, "quota", `You have used today's ${q.anon} free ${what}. Sign in with Google for ${q.user} a day, ${KEY_HINT}, or come back tomorrow.`, wait);
  if (scope === "ip") return refuse(429, "quota", `This network has used today's shared allowance of ${what}. Sign in with Google, ${KEY_HINT}, or come back tomorrow.`, wait);
  return refuse(429, "quota", `The free ${what} for visitors who are not signed in are used up for today. Sign in with Google, ${KEY_HINT}, or come back tomorrow.`, wait);
}

const busyRefusal = () => refuse(429, "busy-user", "You already have an AI answer being written. Wait for it to finish, then ask again.", 10);

function budgetRefusal(reason: "daily" | "monthly", now: number): Response {
  const when = reason === "daily" ? "today" : "this month";
  return refuse(503, "budget", `The beta's AI budget for ${when} is used up, so the shared AI is paused until it renews (UTC). You can keep going with your own Together key (the key button in the top bar).`, reason === "daily" ? secondsToUtcMidnight(now) : 3600);
}

const unavailableRefusal = () => refuse(503, "unavailable", "The AI is temporarily unavailable. Try again in a minute.", 60);

let lastWarn = 0;
function warnUnavailable(step: string, err: unknown) {
  if (Date.now() - lastWarn < 30_000) return;
  lastWarn = Date.now();
  console.warn(`[ai] allowance store unavailable at ${step} (${err instanceof Error ? err.name : typeof err})`);
}

/* ------------------------------------------------------------------ the gate */

export type Outcome =
  | { kind: "ok"; inputTokens: number; outputTokens: number }
  | { kind: "provider-error" }
  /** The request was refused before anything reached the provider (bad input): free, and the question is given back. */
  | { kind: "rejected" }
  | { kind: "timeout" }
  | { kind: "bad-output" }
  | { kind: "client-gone" };

export type Admission = { ok: true; settle: (outcome: Outcome) => Promise<void> } | { ok: false; response: Response };

export interface AdmitInput {
  req: Request;
  /** Whose key pays: the operator's ("server") or the reader's own ("user"). */
  source: "server" | "user";
  /** The most the request can use; money is set aside for it before it starts. */
  estimate: Estimate;
  /** How long the generation may hold its lease if it never reports back. */
  leaseTtlMs: number;
  model?: string;
  /** Test seam. */
  store?: AiStore;
  now?: number;
}

export async function admitAi(a: AdmitInput): Promise<Admission> {
  const store = a.store ?? aiStore();
  const now = a.now ?? Date.now();
  const client = identifyClient(a.req);
  const token = randomUUID();
  const server = a.source === "server";
  const quotaKeys: string[] = [];
  const heldLeases: string[] = [];
  const reservedMicro = costMicro(a.estimate, a.model);

  const releaseLeases = async () => {
    await Promise.all(heldLeases.splice(0).map((k) => store.releaseLease(k, token).catch(() => {})));
  };
  const undo = async () => {
    await releaseLeases();
    await Promise.all(quotaKeys.splice(0).map((k) => store.quotaRefund(k, DAY_MS, now).catch(() => {})));
  };

  try {
    if (server && !quotasOff()) {
      const q = quotaFor("ai");
      const plan: { key: string; limit: number; scope: Scope }[] = client.accountId
        ? [{ key: `q:ai:user:${client.accountId}`, limit: q.user, scope: "user" }]
        : [
            { key: `q:ai:anon:${client.clientKey}`, limit: q.anon, scope: "anon" },
            { key: `q:ai:ip:${client.ip}`, limit: q.anonIp, scope: "ip" },
            { key: "q:ai:anon-global", limit: q.anonGlobal, scope: "global" },
          ];
      let blocked: Scope | null = null;
      for (const p of plan) {
        const n = await store.quotaHit(p.key, DAY_MS, now);
        quotaKeys.push(p.key);
        if (n > p.limit && !blocked) blocked = p.scope;
      }
      if (blocked) {
        await undo();
        return { ok: false, response: quotaRefusal(blocked, "ai", now) };
      }
    }

    const leaseKeys = client.accountId ? [`l:user:${client.accountId}`] : [`l:reader:${client.clientKey}`, `l:ip:${client.ip}`];
    for (const key of leaseKeys) {
      if (!(await store.acquireLease(key, token, a.leaseTtlMs, now))) {
        await undo();
        return { ok: false, response: busyRefusal() };
      }
      heldLeases.push(key);
    }

    if (server) {
      const r = await store.reserve(token, reservedMicro, budgetLimits(), a.leaseTtlMs, now);
      if (!r.ok) {
        await undo();
        return { ok: false, response: budgetRefusal(r.reason, now) };
      }
    }
  } catch (err) {
    await undo();
    warnUnavailable("admission", err);
    // On the operator's key an unreadable allowance means no spending; on the reader's own key nothing of the operator's is at stake.
    return server ? { ok: false, response: unavailableRefusal() } : { ok: true, settle: async () => {} };
  }

  let settled = false;
  const settle = async (o: Outcome) => {
    if (settled) return;
    settled = true;
    if (server) {
      // What a failed request cost is not known (the provider may have billed it), so it is charged at what was set aside; only a plain provider failure is free.
      const charge: Charge =
        o.kind === "ok"
          ? { micro: costMicro({ inputTokens: o.inputTokens, outputTokens: o.outputTokens }, a.model), inputTokens: o.inputTokens, outputTokens: o.outputTokens, errors: 0 }
          : o.kind === "provider-error" || o.kind === "rejected"
            ? { micro: 0, inputTokens: 0, outputTokens: 0, errors: o.kind === "provider-error" ? 1 : 0 }
            : { micro: reservedMicro, inputTokens: 0, outputTokens: 0, errors: o.kind === "timeout" ? 1 : 0 };
      await store.settle(token, charge, Date.now()).catch((err) => warnUnavailable("settle", err));
      // A provider failure or a refused request did not produce an answer: the reader keeps the question.
      if (o.kind === "provider-error" || o.kind === "rejected") await Promise.all(quotaKeys.splice(0).map((k) => store.quotaRefund(k, DAY_MS, now).catch(() => {})));
    }
    await releaseLeases();
  };
  return { ok: true, settle };
}

/**
 * The daily allowance for the cheaper server-key calls (meaning search, voice transcription). No lease and no budget reservation: their cost per
 * call is tiny and the allowance bounds it. Returns the refusal, or null to go on.
 */
export async function limitDaily(req: Request, bucket: Exclude<QuotaBucket, "ai">, store: AiStore = aiStore(), now: number = Date.now()): Promise<Response | null> {
  if (quotasOff()) return null;
  const client = identifyClient(req);
  const q = quotaFor(bucket);
  const plan: { key: string; limit: number; scope: Scope }[] = client.accountId
    ? [{ key: `q:${bucket}:user:${client.accountId}`, limit: q.user, scope: "user" }]
    : [
        { key: `q:${bucket}:anon:${client.clientKey}`, limit: q.anon, scope: "anon" },
        { key: `q:${bucket}:ip:${client.ip}`, limit: q.anonIp, scope: "ip" },
        { key: `q:${bucket}:anon-global`, limit: q.anonGlobal, scope: "global" },
      ];
  try {
    let blocked: Scope | null = null;
    for (const p of plan) if ((await store.quotaHit(p.key, DAY_MS, now)) > p.limit && !blocked) blocked = p.scope;
    return blocked ? quotaRefusal(blocked, bucket, now) : null;
  } catch (err) {
    warnUnavailable("daily allowance", err);
    return unavailableRefusal();
  }
}
