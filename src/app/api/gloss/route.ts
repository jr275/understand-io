import { streamText } from "ai";
import { z } from "zod";
import { CHAT_MODEL, estimateCost, noKeyResponse, provider, resolveKey } from "@/lib/ai/provider";
import { actionQuestion, systemPrompt, userPrompt } from "@/lib/ai/prompts";
import { GLOSS_ACTIONS, LIMITS, SERVER_KEY_ERROR, anchorSchema, historySchema, limitHistory } from "@/lib/ai/requestLimits";
import { readJsonLimited } from "@/lib/server/body";
import { limitServerKey } from "@/lib/server/rateLimit";
import { admitAi, type Outcome } from "@/lib/server/aiAdmission";
import { estimateStreamedUsage, worstCaseGloss } from "@/lib/ai/budget";
import { DEADLINE_MS, NO_ROOM_MESSAGE, PROVIDER_RETRIES, TIMEOUT_MESSAGE, busyResponse, deadlineSignal, logUsage, providerOptions, timedOut, tryAcquire, withHeadroom } from "@/lib/ai/guard";

export const maxDuration = 60;

const Body = z.object({
  title: z.string().max(400),
  author: z.string().max(200).nullable().optional(),
  action: z.enum(GLOSS_ACTIONS),
  question: z.string().max(2000).optional(),
  anchor: anchorSchema.nullable(),
  context: z
    .array(z.object({ id: z.string().max(LIMITS.blockId), n: z.number().optional(), text: z.string().max(LIMITS.contextBlockChars) }))
    .max(LIMITS.contextBlocks)
    .refine((c) => c.reduce((n, b) => n + b.text.length, 0) <= LIMITS.contextChars, "Too much context."),
  length: z.string().max(10).optional(),
  history: historySchema.optional(),
});

export const SENTINEL = "\u001e";

export async function GET() {
  return Response.json({ serverKey: !!process.env.TOGETHER_API_KEY, model: CHAT_MODEL });
}

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
  const b = parsed.data;
  const release = source === "server" ? tryAcquire() : () => {};
  if (!release) return busyResponse();
  const question = actionQuestion(b.action, b.question);
  const history = limitHistory(b.history);
  const messages = [
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: userPrompt({ title: b.title, author: b.author, anchor: b.anchor, context: b.context, question }) },
  ];
  const maxOutputTokens = withHeadroom(b.length === "long" ? 900 : b.length === "short" ? 220 : 480);
  const chars = b.title.length + question.length + (b.anchor?.quote.length ?? 0) + b.context.reduce((n, c) => n + c.text.length, 0) + history.reduce((n, t) => n + t.content.length, 0);
  // The reader's daily allowance, one generation at a time, and the global budget (see lib/server/aiAdmission.ts).
  const admission = await admitAi({ req, source: source === "server" ? "server" : "user", estimate: worstCaseGloss(chars, maxOutputTokens), leaseTtlMs: DEADLINE_MS.stream + 30_000, model: CHAT_MODEL });
  if (!admission.ok) {
    release();
    return admission.response;
  }
  const signal = deadlineSignal(req.signal, DEADLINE_MS.stream);
  try {
    let providerError: unknown;
    const result = streamText({
      model: provider(key).chatModel(CHAT_MODEL),
      system: systemPrompt(b.length ?? "normal"),
      messages,
      temperature: 0.4,
      maxOutputTokens,
      providerOptions: providerOptions(),
      abortSignal: signal,
      maxRetries: PROVIDER_RETRIES,
      // The SDK's default logs the whole error (request body values included) to stdout; the stream trailer already reports it to the caller.
      onError: ({ error }) => {
        providerError = error;
        console.warn("[gloss] provider call failed:", (error as { statusCode?: number } | null)?.statusCode ?? (error instanceof Error ? error.name : "unknown"));
      },
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          let answered = false;
          let outChars = 0;
          for await (const part of result.textStream) {
            if (part.trim()) answered = true;
            outChars += part.length;
            controller.enqueue(encoder.encode(part));
          }
          if (!answered) throw new Error("empty answer");
          const usage = await result.totalUsage;
          // A provider that streams without a usage report must not make the answer free: fall back to an estimate from what was sent and received.
          const reported = (usage.inputTokens ?? 0) > 0 || (usage.outputTokens ?? 0) > 0;
          const fallback = estimateStreamedUsage(chars, outChars);
          const input = reported ? (usage.inputTokens ?? 0) : fallback.inputTokens;
          const output = reported ? (usage.outputTokens ?? 0) : fallback.outputTokens;
          const cost = estimateCost(CHAT_MODEL, input, output);
          logUsage("gloss", b.action, source, CHAT_MODEL, { input, output, cost });
          await admission.settle({ kind: "ok", inputTokens: input, outputTokens: output });
          controller.enqueue(encoder.encode(SENTINEL + JSON.stringify({ model: CHAT_MODEL, usage: { input, output, cost } })));
        } catch (err) {
          const empty = err instanceof Error && err.message === "empty answer";
          const outcome: Outcome = req.signal.aborted ? { kind: "client-gone" } : timedOut(signal, req.signal) ? { kind: "timeout" } : empty && !providerError ? { kind: "bad-output" } : { kind: "provider-error" };
          await admission.settle(outcome);
          controller.enqueue(encoder.encode(SENTINEL + JSON.stringify({ error: timedOut(signal, req.signal) ? TIMEOUT_MESSAGE : providerError || !(err instanceof Error && err.message === "empty answer") ? describe(providerError ?? err, source) : NO_ROOM_MESSAGE })));
        } finally {
          release();
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-gloss-model": CHAT_MODEL } });
  } catch (err) {
    await admission.settle({ kind: "provider-error" });
    release();
    return Response.json({ error: "provider", message: describe(err, source) }, { status: 502 });
  }
}

/** With the server key the caller only ever sees a fixed message: provider text can carry billing or account details. */
function describe(err: unknown, source: "user" | "server" | null) {
  if (source === "server") return SERVER_KEY_ERROR;
  const m = err instanceof Error ? err.message : String(err);
  if (/401|invalid api key|unauthorized/i.test(m)) return "That key was not accepted by Together AI.";
  if (/429|rate limit/i.test(m)) return "Together AI is rate-limiting right now. Try again in a moment.";
  if (/model/i.test(m) && /not found|does not exist/i.test(m)) return `The model ${CHAT_MODEL} is not available on this key.`;
  return m.slice(0, 300);
}
