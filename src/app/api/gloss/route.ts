import { streamText } from "ai";
import { z } from "zod";
import { CHAT_MODEL, estimateCost, noKeyResponse, provider, resolveKey } from "@/lib/ai/provider";
import { actionQuestion, systemPrompt, userPrompt } from "@/lib/ai/prompts";

export const maxDuration = 60;

const Body = z.object({
  title: z.string().max(400),
  author: z.string().max(200).nullable().optional(),
  action: z.string().max(20),
  question: z.string().max(2000).optional(),
  anchor: z
    .object({ start: z.object({ b: z.string(), o: z.number() }), end: z.object({ b: z.string(), o: z.number() }), quote: z.string(), prefix: z.string().optional(), suffix: z.string().optional() })
    .nullable(),
  context: z
    .array(z.object({ id: z.string().max(40), n: z.number().optional(), text: z.string().max(6000) }))
    .max(80)
    .refine((c) => c.reduce((n, b) => n + b.text.length, 0) <= 30000, "Too much context."),
  length: z.string().max(10).optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(40).optional(),
});

export const SENTINEL = "\u001e";

export async function GET() {
  return Response.json({ serverKey: !!process.env.TOGETHER_API_KEY, model: CHAT_MODEL });
}

export async function POST(req: Request) {
  const { key } = resolveKey(req);
  if (!key) return noKeyResponse();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad-request", message: "Malformed request." }, { status: 400 });
  const b = parsed.data;
  const question = actionQuestion(b.action as never, b.question);
  const messages = [
    ...(b.history ?? []).map((t) => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: userPrompt({ title: b.title, author: b.author, anchor: b.anchor, context: b.context, question }) },
  ];
  try {
    const result = streamText({
      model: provider(key).chatModel(CHAT_MODEL),
      system: systemPrompt(b.length ?? "normal"),
      messages,
      temperature: 0.4,
      maxOutputTokens: b.length === "long" ? 900 : b.length === "short" ? 220 : 480,
      abortSignal: req.signal,
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const part of result.textStream) controller.enqueue(encoder.encode(part));
          const usage = await result.totalUsage;
          const input = usage.inputTokens ?? 0;
          const output = usage.outputTokens ?? 0;
          controller.enqueue(encoder.encode(SENTINEL + JSON.stringify({ model: CHAT_MODEL, usage: { input, output, cost: estimateCost(CHAT_MODEL, input, output) } })));
        } catch (err) {
          controller.enqueue(encoder.encode(SENTINEL + JSON.stringify({ error: describe(err) })));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-gloss-model": CHAT_MODEL } });
  } catch (err) {
    return Response.json({ error: "provider", message: describe(err) }, { status: 502 });
  }
}

function describe(err: unknown) {
  const m = err instanceof Error ? err.message : String(err);
  if (/401|invalid api key|unauthorized/i.test(m)) return "That key was not accepted by Together AI.";
  if (/429|rate limit/i.test(m)) return "Together AI is rate-limiting right now. Try again in a moment.";
  if (/model/i.test(m) && /not found|does not exist/i.test(m)) return `The model ${CHAT_MODEL} is not available on this key.`;
  return m.slice(0, 300);
}
