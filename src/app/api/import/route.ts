import { z } from "zod";
import { documentFromExtracted, extractArticle } from "@/lib/content/extract";
import { readJsonLimited } from "@/lib/server/body";
import { ensureReaderId } from "@/lib/server/reader";
import { saveDocument } from "@/lib/server/documents";
import { fetchPublic } from "@/lib/server/safeFetch";
import { describeFetchStatus } from "@/lib/server/importStatus";
import { importErrorResponse } from "@/lib/server/importErrors";

export const maxDuration = 45;

const Body = z.object({ url: z.string().url().max(2048) });

export async function POST(req: Request) {
  const json = await readJsonLimited(req, 16 * 1024);
  if (json === "too-large") return Response.json({ error: "That request is too large." }, { status: 413 });
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: "That does not look like a link." }, { status: 400 });
  const url = parsed.data.url;
  try {
    const readerId = await ensureReaderId();
    const { res, body, finalUrl } = await fetchPublic(url);
    if (!res.ok) {
      const d = describeFetchStatus(res.status);
      return Response.json({ error: d.error, blocked: d.blocked, upstream: res.status }, { status: d.status });
    }
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
    return importErrorResponse(err, "Could not read that page.", true);
  }
}
