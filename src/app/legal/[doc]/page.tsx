import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalDocPage } from "@/components/legal/LegalDocPage";
import { LEGAL_DOCS, asLang, isLegalDoc } from "@/lib/legal/docs";

export const dynamic = "force-dynamic"; // whether it may be shown depends on the operator's switch, read at request time

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params;
  return { title: isLegalDoc(doc) ? LEGAL_DOCS[doc].title.en : "Not found" };
}

export default async function Page({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { doc } = await params;
  if (!isLegalDoc(doc)) notFound();
  return <LegalDocPage doc={doc} lang={asLang((await searchParams).lang)} />;
}
