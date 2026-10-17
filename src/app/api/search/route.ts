import { embedMany } from "ai";
import { z } from "zod";
import { EMBED_MODEL, provider, resolveKey } from "@/lib/ai/provider";
import { LIMITS, SERVER_KEY_ERROR } from "@/lib/ai/requestLimits";
import { readJsonLimited } from "@/lib/server/body";
import { limitServerKey } from "@/lib/server/rateLimit";

export const maxDuration = 30;

const Body = z.object({
  q: z.string().min(1).max(500),
  passages: z
    .array(z.object({ key: z.string().max(LIMITS.blockId), text: z.string().max(2000) }))
    .max(40)
    .refine((p) => p.reduce((n, x) => n + x.text.length, 0) <= LIMITS.searchChars, "Too much text."),
});

/** Semantic re-ranking: cosine similarity between the query and candidate passages. */
export async function POST(req: Request) {
  const { key, source } = resolveKey(req);
  if (!key) return Response.json({ error: "needs-key", message: "Semantic search needs a Together AI key; lexical search still works." }, { status: 402 });
  if (source === "server") {
    const limited = limitServerKey(req, "search");
    if (limited) return limited;
  }
  const json = await readJsonLimited(req, LIMITS.jsonBytes);
  if (json === "too-large") return Response.json({ error: "too-large" }, { status: 413 });
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });
  const { q, passages } = parsed.data;
  try {
    const { embeddings } = await embedMany({ model: provider(key).embeddingModel(EMBED_MODEL), values: [q, ...passages.map((p) => p.text)], abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(20000)]) });
    const [qv, ...pv] = embeddings;
    const scores = pv.map((v) => cosine(qv, v));
    return Response.json({ scores: passages.map((p, i) => ({ key: p.key, score: scores[i] })), model: EMBED_MODEL });
  } catch (err) {
    return Response.json({ error: "provider", message: source === "server" ? SERVER_KEY_ERROR : err instanceof Error ? err.message.slice(0, 300) : "Embedding failed." }, { status: 502 });
  }
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
