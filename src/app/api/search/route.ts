import { embedMany } from "ai";
import { z } from "zod";
import { EMBED_MODEL, provider, resolveKey } from "@/lib/ai/provider";

export const maxDuration = 30;

const Body = z.object({
  q: z.string().min(1).max(500),
  passages: z.array(z.object({ key: z.string(), text: z.string().max(2000) })).max(40),
});

/** Semantic re-ranking: cosine similarity between the query and candidate passages. */
export async function POST(req: Request) {
  const { key } = resolveKey(req);
  if (!key) return Response.json({ error: "needs-key", message: "Semantic search needs a Together AI key; lexical search still works." }, { status: 402 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });
  const { q, passages } = parsed.data;
  try {
    const { embeddings } = await embedMany({ model: provider(key).embeddingModel(EMBED_MODEL), values: [q, ...passages.map((p) => p.text)] });
    const [qv, ...pv] = embeddings;
    const scores = pv.map((v) => cosine(qv, v));
    return Response.json({ scores: passages.map((p, i) => ({ key: p.key, score: scores[i] })), model: EMBED_MODEL });
  } catch (err) {
    return Response.json({ error: "provider", message: err instanceof Error ? err.message.slice(0, 300) : "Embedding failed." }, { status: 502 });
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
