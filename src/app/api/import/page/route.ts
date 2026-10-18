import { z } from "zod";
import { documentFromExtracted, extractArticle } from "@/lib/content/extract";
import { HTML_LIMITS } from "@/lib/content/limits";
import { readJsonLimited } from "@/lib/server/body";
import { ensureReaderId } from "@/lib/server/reader";
import { saveDocument } from "@/lib/server/documents";
import { importErrorResponse } from "@/lib/server/importErrors";
import { limitImports } from "@/lib/server/rateLimit";

export const maxDuration = 30;

/**
 * Import a page whose HTML was captured in the reader's own browser (bookmarklet / extension).
 * Sites that block server-side fetches or sit behind the reader's own login still work this way,
 * because the server never contacts the site: it only runs Readability over the HTML it is given.
 */
const Body = z.object({
  url: z.string().url().max(2048),
  html: z.string().min(1).max(HTML_LIMITS.chars),
  title: z.string().max(300).optional(),
});

export async function POST(req: Request) {
  const limited = limitImports(req);
  if (limited) return limited;
  // 4 bytes per character at most, plus the envelope.
  const json = await readJsonLimited(req, HTML_LIMITS.chars * 4 + 8192);
  if (json === "too-large") return Response.json({ error: "That page is too large to read here (over 4 MB of HTML). Paste its text instead." }, { status: 413 });
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: "No page content received: send JSON with a url and the page's html." }, { status: 400 });
  const { url, html, title } = parsed.data;
  if (!/^https?:$/.test(new URL(url).protocol)) return Response.json({ error: "Only http(s) pages can be read." }, { status: 400 });
  try {
    const readerId = await ensureReaderId();
    const extracted = extractArticle(html, url);
    if (title && (!extracted.title || extracted.title === new URL(url).hostname)) extracted.title = title.trim();
    const doc = documentFromExtracted(extracted, url);
    const saved = await saveDocument(readerId, doc);
    return Response.json({ document: saved, persisted: saved.persisted });
  } catch (err) {
    return importErrorResponse(err, "Could not read that page.");
  }
}
