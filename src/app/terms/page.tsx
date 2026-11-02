import type { Metadata } from "next";
import { LegalDocPage } from "@/components/legal/LegalDocPage";
import { asLang } from "@/lib/legal/docs";
import { legalMetadata } from "@/lib/seo/legal";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ lang?: string }> }): Promise<Metadata> {
  return legalMetadata("terms", asLang((await searchParams).lang));
}
export const dynamic = "force-dynamic"; // whether it may be shown depends on the operator's switch, read at request time

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  return <LegalDocPage doc="terms" lang={asLang((await searchParams).lang)} />;
}
