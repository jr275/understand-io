import { CHAT_MODEL, estimateCost } from "./provider";
import { OP_LIMITS, VARIANT_TOKENS, planChunks, type AiOpInput } from "./ops";
import { REASONING_HEADROOM } from "./guard";

/**
 * What a reader may ask of the operator's AI key, and what the key may cost in total. Every number comes from the environment so it can be
 * changed without a release; the defaults are the beta's. Nothing here touches a database: it is the policy, `server/aiAdmission.ts` applies it.
 */

const whole = (name: string, fallback: number) => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};
const dollars = (name: string, fallback: number) => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export type QuotaBucket = "ai" | "search" | "transcribe";

export interface Quota {
  /** Per day, for a visitor who is not signed in (counted per browser). */
  anon: number;
  /** Per day, for everyone behind one network address who is not signed in: a second guard, so clearing cookies does not reset the allowance. Higher than `anon` because a household or an office shares an address. */
  anonIp: number;
  /** Per day, for all visitors who are not signed in together. */
  anonGlobal: number;
  /** Per day, for a signed-in account (across all its devices). */
  user: number;
}

const DEFAULTS: Record<QuotaBucket, Quota> = {
  ai: { anon: 3, anonIp: 10, anonGlobal: 300, user: 20 },
  search: { anon: 20, anonIp: 60, anonGlobal: 2000, user: 100 },
  transcribe: { anon: 5, anonIp: 15, anonGlobal: 200, user: 30 },
};

const PREFIX: Record<QuotaBucket, string> = { ai: "GLOSS_QUOTA_AI", search: "GLOSS_QUOTA_SEARCH", transcribe: "GLOSS_QUOTA_TRANSCRIBE" };

/** `GLOSS_QUOTA_AI_ANON_PER_DAY`, `..._ANON_IP_PER_DAY`, `..._ANON_GLOBAL_PER_DAY`, `..._USER_PER_DAY` (and the same for SEARCH and TRANSCRIBE). */
export function quotaFor(bucket: QuotaBucket): Quota {
  const d = DEFAULTS[bucket];
  const p = PREFIX[bucket];
  return {
    anon: whole(`${p}_ANON_PER_DAY`, d.anon),
    anonIp: whole(`${p}_ANON_IP_PER_DAY`, d.anonIp),
    anonGlobal: whole(`${p}_ANON_GLOBAL_PER_DAY`, d.anonGlobal),
    user: whole(`${p}_USER_PER_DAY`, d.user),
  };
}

/** A development and test switch. It is ignored in production, where the quotas and the budget always apply. */
export const quotasOff = () => process.env.NODE_ENV !== "production" && process.env.GLOSS_QUOTAS === "off";

/** US dollars the operator's key may spend per UTC day and per UTC month, as millionths of a dollar. A budget of 0 pauses the shared AI. */
export function budgetLimits(): { dailyMicro: number; monthlyMicro: number } {
  return { dailyMicro: toMicro(dollars("GLOSS_BUDGET_DAILY_USD", 3)), monthlyMicro: toMicro(dollars("GLOSS_BUDGET_MONTHLY_USD", 40)) };
}

export const toMicro = (usd: number) => Math.round(usd * 1_000_000);

/* ------------------------------------------------------------------ what a request can cost at most */

/** Characters per token used when estimating input size. Low on purpose (more tokens than usual), so the estimate errs on the side of the budget. */
export const CHARS_PER_TOKEN = 3;
const OVERHEAD_CHARS = 1800;
/** A reply that cannot be used is asked for once more, so every call may happen twice. */
const RETRY_FACTOR = 2;

export interface Estimate {
  inputTokens: number;
  outputTokens: number;
}

const tokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

/** The most tokens one `/api/ai` request can use: every provider call it may make, each at its output cap, each asked twice. Mirrors `runAiOp`. */
export function worstCaseOp(input: AiOpInput): Estimate {
  const head = REASONING_HEADROOM;
  if (input.op === "translate") {
    const chars = (input.selection?.length ?? 0) + input.blocks.reduce((n, b) => n + b.text.length, 0) + OVERHEAD_CHARS;
    const out = Math.min(2400, 300 + Math.ceil((input.selection?.length ?? 0) / 2)) + head;
    return { inputTokens: tokens(chars) * RETRY_FACTOR, outputTokens: out * RETRY_FACTOR };
  }
  const variant = input.variant ?? "quick";
  const finalOut = (input.op === "summarize" ? VARIANT_TOKENS[variant] : 1300) + head;
  const isPassage = input.op === "summarize" && variant === "passage";
  const totalChars = input.blocks.reduce((n, b) => n + b.text.length, 0);
  if (isPassage || totalChars <= OP_LIMITS.directChars) {
    return { inputTokens: tokens(totalChars + (input.selection?.length ?? 0) + OVERHEAD_CHARS) * RETRY_FACTOR, outputTokens: finalOut * RETRY_FACTOR };
  }
  const chunks = planChunks(input.blocks, OP_LIMITS.chunkChars).slice(0, OP_LIMITS.maxChunks);
  const sectionIn = chunks.reduce((n, c) => n + c.reduce((m, b) => m + b.text.length, 0) + OVERHEAD_CHARS, 0);
  const sectionOut = chunks.length * (900 + head);
  // The combining call reads the notes the sections produced: at most a section's output cap of characters per section.
  const digestChars = chunks.length * (900 + head) * CHARS_PER_TOKEN + OVERHEAD_CHARS;
  return { inputTokens: tokens(sectionIn + digestChars) * RETRY_FACTOR, outputTokens: (sectionOut + finalOut) * RETRY_FACTOR };
}

/** The most tokens one margin answer can use. */
export function worstCaseGloss(chars: number, maxOutputTokens: number): Estimate {
  return { inputTokens: tokens(chars + OVERHEAD_CHARS), outputTokens: maxOutputTokens };
}

/**
 * What a streamed answer used when the provider did not say (a missing or all-zero usage report): the characters sent plus the fixed prompt overhead,
 * and the characters received, at the same low characters-per-token as the worst case. Better a slight overcount than a free answer in the ledger.
 */
export function estimateStreamedUsage(inputChars: number, outputChars: number): Estimate {
  return { inputTokens: tokens(inputChars + OVERHEAD_CHARS), outputTokens: Math.max(1, tokens(outputChars)) };
}

/** What an estimate may cost, in millionths of a dollar (at least 1, so every request is visible in the ledger). */
export const costMicro = (e: Estimate, model: string = CHAT_MODEL) => Math.max(1, toMicro(estimateCost(model, e.inputTokens, e.outputTokens)));
