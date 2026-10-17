import { z } from "zod";
import { documentFromExtracted, extractArticle } from "@/lib/content/extract";
import { ensureReaderId } from "@/lib/server/reader";
import { saveDocument } from "@/lib/server/documents";

export const maxDuration = 30;

/**
 * Import a page whose HTML was captured in the reader's own browser (bookmarklet / extension).
 * Sites that block server-side fetches or sit behind the reader's own login still work this way,
 * because the server never contacts the site: it only runs Readability over the HTML it is given.
 */
const Body = z.object({
  url: z.string().url().max(2048),
  html: z.string().min(1).max(10_000_000),
  title: z.string().max(300).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "No page content received." }, { status: 400 });
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
    return Response.json({ error: err instanceof Error ? err.message : "Could not read that page." }, { status: 422 });
  }
}
