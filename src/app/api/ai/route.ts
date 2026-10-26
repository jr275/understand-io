import { generateText } from "ai";
import { z } from "zod";
import { CHAT_MODEL, estimateCost, noKeyResponse, provider, resolveKey } from "@/lib/ai/provider";
import { LIMITS, SERVER_KEY_ERROR } from "@/lib/ai/requestLimits";
import { DEADLINE_MS, PROVIDER_RETRIES, TIMEOUT_MESSAGE, busyResponse, deadlineSignal, logUsage, timedOut, tryAcquire } from "@/lib/ai/guard";
import { LANGUAGE_CODES } from "@/lib/ai/languages";
import { AiOpError, OP_LIMITS, runAiOp, type Generate } from "@/lib/ai/ops";
import { readJsonLimited } from "@/lib/server/body";
import { limitServerKey } from "@/lib/server/rateLimit";

export const maxDuration = 120;

const BlockZ = z.object({
  id: z.string().min(1).max(LIMITS.blockId),
  n: z.number().int().min(0).max(1_000_000).optional(),
  type: z.string().max(12).optional(),
  text: z.string().max(LIMITS.contextBlockChars),
});

const Body = z.object({
  op: z.enum(["summarize", "concepts", "questions", "translate"]),
  variant: z.enum(["quick", "executive", "detailed", "ideas", "study", "passage"]).optional(),
  title: z.string().max(400),
  author: z.string().max(200).nullable().optional(),
  blocks: z
    .array(BlockZ)
    .max(OP_LIMITS.maxBlocks)
    .refine((b) => b.reduce((n, x) => n + x.text.length, 0) <= OP_LIMITS.maxChars, "Too much text."),
  totalParagraphs: z.number().int().min(0).max(1_000_000),
  selection: z.string().max(LIMITS.quote).optional(),
  targetLang: z.enum(LANGUAGE_CODES).optional(),
  outputLang: z.enum(LANGUAGE_CODES).optional(),
});

/** Structured reading operations: summaries, concepts, comprehension questions, translation. One JSON answer, checked before it is returned. */
export async function POST(req: Request) {
  const { key, source } = resolveKey(req);
  if (!key) return noKeyResponse();
  if (source === "server") {
    const limited = await limitServerKey(req, "gloss");
    if (limited) return limited;
  }
  const json = await readJsonLimited(req, LIMITS.jsonBytes);
  if (json === "too-large") return Response.json({ error: "too-large", message: "That request is too large." }, { status: 413 });
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: "bad-request", message: "Malformed request." }, { status: 400 });
  // Server-key work runs at most a few at a time per instance; the reader's own key is theirs to spend.
  const release = source === "server" ? tryAcquire() : () => {};
  if (!release) return busyResponse();
  const signal = deadlineSignal(req.signal, DEADLINE_MS.structured);
  const model = provider(key).chatModel(CHAT_MODEL);
  const generate: Generate = async ({ system, prompt, maxOutputTokens, signal }) => {
    const r = await generateText({ model, system, prompt, temperature: 0.2, maxOutputTokens, abortSignal: signal, maxRetries: PROVIDER_RETRIES });
    return { text: r.text, inputTokens: r.usage?.inputTokens ?? 0, outputTokens: r.usage?.outputTokens ?? 0 };
  };
  try {
    const { result, usage } = await runAiOp(parsed.data, generate, signal);
    const cost = estimateCost(CHAT_MODEL, usage.input, usage.output);
    logUsage("ai", `${parsed.data.op}${parsed.data.variant ? `:${parsed.data.variant}` : ""}`, source, CHAT_MODEL, { ...usage, cost });
    return Response.json({ result, model: CHAT_MODEL, usage: { ...usage, cost } });
  } catch (err) {
    if (err instanceof AiOpError) return Response.json({ error: err.code, message: err.message }, { status: err.code === "bad-output" ? 502 : 400 });
    if (req.signal.aborted) return new Response(null, { status: 499 });
    if (timedOut(signal, req.signal)) return Response.json({ error: "timeout", message: TIMEOUT_MESSAGE }, { status: 504 });
    // Only the status reaches the log: provider errors can carry request text.
    console.warn("[ai] provider call failed:", (err as { statusCode?: number } | null)?.statusCode ?? (err instanceof Error ? err.name : "unknown"));
    return Response.json({ error: "provider", message: describe(err, source) }, { status: 502 });
  } finally {
    release();
  }
}

function describe(err: unknown, source: "user" | "server" | null) {
  if (source === "server") return SERVER_KEY_ERROR;
  const m = err instanceof Error ? err.message : String(err);
  if (/401|invalid api key|unauthorized/i.test(m)) return "That key was not accepted by Together AI.";
  if (/429|rate limit/i.test(m)) return "Together AI is rate-limiting right now. Try again in a moment.";
  if (/model/i.test(m) && /not found|does not exist/i.test(m)) return `The model ${CHAT_MODEL} is not available on this key.`;
  return "The AI service could not answer right now. Try again.";
}
