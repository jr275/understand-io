import type { Metadata } from "next";
import { getReaderId } from "@/lib/server/reader";
import { loadDocument, loadDocumentResult } from "@/lib/server/documents";
import { ReaderLoader } from "@/components/reader/ReaderLoader";
import { NOINDEX, SITE_NAME, alternatesFor, socialFor } from "@/lib/seo/site";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = await loadDocument(slug, await getReaderId());
  if (!doc) return { title: SITE_NAME, robots: NOINDEX };
  const title = `${doc.title}, glossed`;
  // Only the bundled samples (public-domain essays that show the product) may be found; anything a reader saved is theirs alone.
  if (doc.kind !== "sample") return { title, robots: NOINDEX };
  const description = `${doc.dek ?? doc.title} Read ${doc.author ? `${doc.author}'s ` : ""}text with Understand.io: select a line, ask it anything, and the answer is written in the margin with the paragraphs it used.`;
  return { title, description, alternates: alternatesFor(`/read/${doc.slug}`), ...socialFor({ title, description, path: `/read/${doc.slug}`, type: "article" }) };
}

export default async function ReadPage({ params }: Props) {
  const { slug } = await params;
  const readerId = await getReaderId();
  const { doc, unavailable } = await loadDocumentResult(slug, readerId);
  return <ReaderLoader slug={slug} initial={doc} unavailable={unavailable} />;
}
