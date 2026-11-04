import type { Metadata } from "next";
import { LegalDocPage } from "@/components/legal/LegalDocPage";
import { legalLang } from "@/lib/legal/lang";
import { legalMetadata } from "@/lib/seo/legal";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ lang?: string }> }): Promise<Metadata> {
  return legalMetadata("privacy", await legalLang(searchParams));
}
export const dynamic = "force-dynamic"; // whether it may be shown depends on the operator's switch, read at request time

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  return <LegalDocPage doc="privacy" lang={await legalLang(searchParams)} />;
}
