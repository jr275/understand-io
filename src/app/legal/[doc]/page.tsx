import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalDocPage } from "@/components/legal/LegalDocPage";
import { asLang, isLegalDoc } from "@/lib/legal/docs";
import { legalMetadata } from "@/lib/seo/legal";

export const dynamic = "force-dynamic"; // whether it may be shown depends on the operator's switch, read at request time

export async function generateMetadata({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<{ lang?: string }> }): Promise<Metadata> {
  const { doc } = await params;
  return isLegalDoc(doc) ? legalMetadata(doc, asLang((await searchParams).lang)) : { title: "Not found" };
}

export default async function Page({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { doc } = await params;
  if (!isLegalDoc(doc)) notFound();
  return <LegalDocPage doc={doc} lang={asLang((await searchParams).lang)} />;
}
