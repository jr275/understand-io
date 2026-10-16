import { z } from "zod";
import { documentFromExtracted, extractArticle } from "@/lib/content/extract";
import { ensureReaderId } from "@/lib/server/reader";
import { saveDocument } from "@/lib/server/documents";

export const maxDuration = 45;

const Body = z.object({ url: z.string().url() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That does not look like a link." }, { status: 400 });
  const url = parsed.data.url;
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\])/.test(u.hostname)) {
    return Response.json({ error: "Only public http(s) links can be read." }, { status: 400 });
  }
  const readerId = await ensureReaderId();
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; GlossReader/0.1; +https://localhost)", accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return Response.json({ error: "That page could not be reached." }, { status: 502 });
  }
  if (!res.ok) return Response.json({ error: `That page answered ${res.status}.` }, { status: 502 });
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("pdf")) {
    const { documentFromPdf } = await import("@/lib/content/pdf");
    const bytes = new Uint8Array(await res.arrayBuffer());
    const doc = await documentFromPdf(bytes, u.pathname.split("/").pop() || "document.pdf");
    doc.sourceUrl = url;
    const saved = await saveDocument(readerId, doc);
    return Response.json({ document: saved, persisted: saved.persisted });
  }
  const html = await res.text();
  try {
    const extracted = extractArticle(html, res.url || url);
    const doc = documentFromExtracted(extracted, res.url || url);
    const saved = await saveDocument(readerId, doc);
    return Response.json({ document: saved, persisted: saved.persisted });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not read that page." }, { status: 422 });
  }
}
