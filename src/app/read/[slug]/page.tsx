import type { Metadata } from "next";
import { getReaderId } from "@/lib/server/reader";
import { loadDocument, loadDocumentResult } from "@/lib/server/documents";
import { ReaderLoader } from "@/components/reader/ReaderLoader";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = await loadDocument(slug, await getReaderId());
  return { title: doc ? `${doc.title}, glossed` : "Understand.io" };
}

export default async function ReadPage({ params }: Props) {
  const { slug } = await params;
  const readerId = await getReaderId();
  const { doc, unavailable } = await loadDocumentResult(slug, readerId);
  return <ReaderLoader slug={slug} initial={doc} unavailable={unavailable} />;
}
