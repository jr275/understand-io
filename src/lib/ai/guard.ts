/**
 * Bounds on what one request may make the provider do, and the one line it leaves in the log. Nothing here sees document text or the
 * key: the log line carries counts and a cost estimate only.
 */

const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** Longest a request may wait for the provider, retries included (a streamed answer; a structured operation may read several sections). */
export const DEADLINE_MS = {
  stream: positive(process.env.GLOSS_AI_STREAM_TIMEOUT_MS, 50_000),
  structured: positive(process.env.GLOSS_AI_TIMEOUT_MS, 100_000),
} as const;

/** The SDK retries a rate-limited or failing provider call with growing waits; this is the most it may add to one call. */
export const PROVIDER_RETRIES = 2;

/** A signal that fires when the caller goes away or the deadline passes, whichever is first. */
export function deadlineSignal(caller: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([caller, AbortSignal.timeout(ms)]);
}

/** True when `signal` fired because of the deadline and not because the caller left. */
export const timedOut = (signal: AbortSignal, caller: AbortSignal) => signal.aborted && !caller.aborted;

export const TIMEOUT_MESSAGE = "The AI service took too long to answer. Try again, or ask about a shorter passage.";

/* ------------------------------------------------------------------ reasoning models */

/**
 * Models that think before they answer (gpt-oss, the Qwen3 and MiniMax families, ...) count that thinking against the output limit. With
 * a cap sized for the answer alone, a short answer can come back empty: the whole budget went on thinking. Every cap therefore gets this
 * much room on top. It costs nothing when the model answers briefly (the prompt asks for brevity and the model stops by itself); it only
 * bounds the worst case.
 */
export const REASONING_HEADROOM = 1200;
export const withHeadroom = (maxOutputTokens: number) => maxOutputTokens + REASONING_HEADROOM;

/**
 * `GLOSS_REASONING_EFFORT=low|medium|high` asks a reasoning model to think less (faster, cheaper). Unset by default: a model that does not
 * take the parameter would refuse the request, so it is sent only when the operator asks for it.
 */
export function providerOptions(): { openaiCompatible: { reasoningEffort: string } } | undefined {
  const v = process.env.GLOSS_REASONING_EFFORT?.trim().toLowerCase();
  return v === "low" || v === "medium" || v === "high" ? { openaiCompatible: { reasoningEffort: v } } : undefined;
}

export const NO_ROOM_MESSAGE = "The AI model used up its room thinking and gave no answer. Try again, or ask for a longer answer.";

/* ------------------------------------------------------------------ concurrency */

/**
 * Provider calls paid for by the server key that may run at once in this process. It keeps a burst from queuing up work (and cost) the
 * provider will refuse anyway. It is per instance, like the in-process rate limit, not a global cap.
 */
export const MAX_CONCURRENT = positive(process.env.GLOSS_AI_MAX_CONCURRENT, 8);

let inFlight = 0;

/** A release function when there is room, otherwise null. Call the release exactly once, when the work is over. */
export function tryAcquire(limit = MAX_CONCURRENT): (() => void) | null {
  if (inFlight >= limit) return null;
  inFlight += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight -= 1;
  };
}

export const inFlightCount = () => inFlight;

export function busyResponse(): Response {
  return Response.json({ error: "busy", message: "The shared AI service is busy right now. Try again in a few seconds." }, { status: 503, headers: { "retry-after": "5", "cache-control": "no-store" } });
}

/* ------------------------------------------------------------------ usage */

/** One log line per provider answer: which operation, whose key paid, how many tokens, what it cost (estimate). */
export function logUsage(route: "ai" | "gloss", op: string, source: "user" | "server" | null, model: string, usage: { input: number; output: number; cost: number }) {
  console.info(`[usage] route=${route} op=${op} key=${source ?? "none"} model=${model} in=${usage.input} out=${usage.output} cost_usd=${usage.cost.toFixed(5)}`);
}
