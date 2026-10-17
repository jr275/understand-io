import { z } from "zod";
import { documentFromExtracted, extractArticle } from "@/lib/content/extract";
import { readJsonLimited } from "@/lib/server/body";
import { ensureReaderId } from "@/lib/server/reader";
import { saveDocument } from "@/lib/server/documents";
import { fetchPublic } from "@/lib/server/safeFetch";
import { describeFetchStatus } from "@/lib/server/importStatus";
import { classifyFetched } from "@/lib/content/uploadKind";
import { documentFromText } from "@/lib/content/text";
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
    const pathname = new URL(finalUrl).pathname;
    const kind = classifyFetched(type, pathname, body.subarray(0, 8192));
    if (kind === "unsupported") {
      return Response.json({ error: "That link is not a web page, a PDF or plain text, so it cannot be read here. Open it in your browser and paste the text, or upload a file." }, { status: 415 });
    }
    if (kind === "pdf") {
      const { documentFromPdf } = await import("@/lib/content/pdf");
      const doc = await documentFromPdf(body, decodeURIComponent(pathname.split("/").pop() || "") || "document.pdf");
      doc.sourceUrl = finalUrl;
      const saved = await saveDocument(readerId, doc);
      return Response.json({ document: saved, persisted: saved.persisted });
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(body);
    if (kind === "text") {
      const doc = documentFromText(decoded, decodeURIComponent(pathname.split("/").pop() || "").replace(/\.(txt|md|markdown)$/i, "") || new URL(finalUrl).hostname);
      doc.sourceUrl = finalUrl;
      doc.sourceLabel = new URL(finalUrl).hostname;
      if (!doc.blocks.length) return Response.json({ error: "Nothing readable at that link." }, { status: 422 });
      const saved = await saveDocument(readerId, doc);
      return Response.json({ document: saved, persisted: saved.persisted });
    }
    const extracted = extractArticle(decoded, finalUrl);
    const doc = documentFromExtracted(extracted, finalUrl);
    const saved = await saveDocument(readerId, doc);
    return Response.json({ document: saved, persisted: saved.persisted });
  } catch (err) {
    return importErrorResponse(err, "Could not read that page.", true);
  }
}
