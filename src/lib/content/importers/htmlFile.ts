import { decodeBytes } from "../charset";
import { extractArticle } from "../extract";
import { ReadError } from "../errors";
import type { GlossDocument } from "../types";
import { documentFromParts, titleFromFileName } from "./common";

/** An address that cannot resolve: relative links and images in a saved page have no site to belong to, and are dropped, not guessed. */
const LOCAL_BASE = "https://local-file.invalid/";

/**
 * A saved web page (.html) → a document. The file is read as content: nothing in it runs, and only its readable article is kept,
 * through the same extraction as an imported link. Links that were relative to the original site are dropped.
 */
export function documentFromHtmlFile(bytes: Uint8Array, fileName: string): GlossDocument {
  const html = decodeBytes(bytes, { html: true });
  const x = extractArticle(html, LOCAL_BASE);
  const blocks = x.blocks
    .filter((b) => b.type !== "figure" || !(b.src ?? "").startsWith(LOCAL_BASE))
    .map((b) => ({ ...b, runs: b.runs?.map((r) => (r.href?.startsWith(LOCAL_BASE) ? { ...r, href: undefined } : r)) }));
  if (!blocks.length) throw new ReadError("Nothing readable in that web page.");
  const hostName = new URL(LOCAL_BASE).hostname;
  return documentFromParts({
    title: x.title && x.title !== hostName ? x.title : titleFromFileName(fileName),
    author: x.author,
    dek: x.dek,
    year: x.published ? new Date(x.published).getFullYear() : null,
    blocks,
    sourceLabel: fileName,
  });
}
