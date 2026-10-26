import { z } from "zod";
import { documentFromExtracted, extractArticle } from "@/lib/content/extract";
import { readJsonLimited } from "@/lib/server/body";
import { ensureReaderId } from "@/lib/server/reader";
import { saveDocument } from "@/lib/server/documents";
import { fetchPublic } from "@/lib/server/safeFetch";
import { describeFetchStatus } from "@/lib/server/importStatus";
import { classifyFetched } from "@/lib/content/uploadKind";
import { documentFromText } from "@/lib/content/text";
import { linkDocument, pageMeta } from "@/lib/content/linkDoc";
import { importErrorResponse } from "@/lib/server/importErrors";
import { limitImports } from "@/lib/server/rateLimit";

export const maxDuration = 45;

const Body = z.object({ url: z.string().url().max(2048), keep: z.boolean().optional() });

export async function POST(req: Request) {
  const limited = await limitImports(req);
  if (limited) return limited;
  const json = await readJsonLimited(req, 16 * 1024);
  if (json === "too-large") return Response.json({ error: "That request is too large." }, { status: 413 });
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: "That does not look like a link." }, { status: 400 });
  const url = parsed.data.url;
  // `keep`: whatever the page turns out to be, the link is saved. Readable pages are read; the others are kept as a link card.
  const keep = parsed.data.keep === true && /^https?:\/\//i.test(url);
  const seen: { html?: string } = {};
  let readerId: string;
  try {
    readerId = await ensureReaderId();
  } catch (err) {
    return importErrorResponse(err, "Could not read that page.", true);
  }
  let res: Response;
  try {
    res = await readLink(url, readerId, seen);
  } catch (err) {
    res = importErrorResponse(err, "Could not read that page.", true);
  }
  // A failure of the server itself (500) is not a reason to save a card; everything else about the page is.
  if (keep && !res.ok && res.status !== 500) {
    const reason = ((await res.clone().json().catch(() => ({}))) as { error?: string }).error ?? "That page could not be read.";
    try {
      // Never keep credentials that were typed into the address.
      const clean = new URL(url);
      clean.username = "";
      clean.password = "";
      const doc = linkDocument({ url: clean.toString(), reason, meta: seen.html ? pageMeta(seen.html) : undefined });
      const saved = await saveDocument(readerId, doc);
      return Response.json({ document: saved, persisted: saved.persisted, duplicate: saved.duplicate, linkOnly: true, reason });
    } catch (err) {
      return importErrorResponse(err, "Could not save that link.");
    }
  }
  return res;
}

/** Fetch and read one link. Returns the answer to send (a saved document or an error); `seen.html` keeps the page for its title and description. */
async function readLink(url: string, readerId: string, seen: { html?: string }): Promise<Response> {
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
    return Response.json({ document: saved, persisted: saved.persisted, duplicate: saved.duplicate });
  }
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(body);
  if (kind === "text") {
    const doc = documentFromText(decoded, decodeURIComponent(pathname.split("/").pop() || "").replace(/\.(txt|md|markdown)$/i, "") || new URL(finalUrl).hostname);
    doc.sourceUrl = finalUrl;
    doc.sourceLabel = new URL(finalUrl).hostname;
    if (!doc.blocks.length) return Response.json({ error: "Nothing readable at that link." }, { status: 422 });
    const saved = await saveDocument(readerId, doc);
    return Response.json({ document: saved, persisted: saved.persisted, duplicate: saved.duplicate });
  }
  seen.html = decoded;
  const extracted = extractArticle(decoded, finalUrl);
  const doc = documentFromExtracted(extracted, finalUrl);
  const saved = await saveDocument(readerId, doc);
  return Response.json({ document: saved, persisted: saved.persisted, duplicate: saved.duplicate });
}
