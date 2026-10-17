import { z } from "zod";
import { documentFromExtracted, extractArticle } from "@/lib/content/extract";
import { ensureReaderId } from "@/lib/server/reader";
import { saveDocument } from "@/lib/server/documents";
import { UnsafeUrlError, fetchPublic } from "@/lib/server/safeFetch";

export const maxDuration = 45;

const Body = z.object({ url: z.string().url().max(2048) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That does not look like a link." }, { status: 400 });
  const url = parsed.data.url;
  try {
    const readerId = await ensureReaderId();
    const { res, body, finalUrl } = await fetchPublic(url);
    if (!res.ok) return Response.json({ error: `That page answered ${res.status}.` }, { status: 502 });
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("pdf")) {
      const { documentFromPdf } = await import("@/lib/content/pdf");
      const doc = await documentFromPdf(body, new URL(finalUrl).pathname.split("/").pop() || "document.pdf");
      doc.sourceUrl = finalUrl;
      const saved = await saveDocument(readerId, doc);
      return Response.json({ document: saved, persisted: saved.persisted });
    }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(body);
    const extracted = extractArticle(html, finalUrl);
    const doc = documentFromExtracted(extracted, finalUrl);
    const saved = await saveDocument(readerId, doc);
    return Response.json({ document: saved, persisted: saved.persisted });
  } catch (err) {
    if (err instanceof UnsafeUrlError) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return Response.json({ error: "That page took too long to answer." }, { status: 504 });
    if (err instanceof TypeError) return Response.json({ error: "That page could not be reached." }, { status: 502 });
    return Response.json({ error: err instanceof Error ? err.message : "Could not read that page." }, { status: 422 });
  }
}
