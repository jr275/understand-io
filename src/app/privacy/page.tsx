import type { Metadata } from "next";
import { LegalDocPage } from "@/components/legal/LegalDocPage";
import { asLang } from "@/lib/legal/docs";

export const metadata: Metadata = { title: "Privacy Policy" };
export const dynamic = "force-dynamic"; // whether it may be shown depends on the operator's switch, read at request time

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  return <LegalDocPage doc="privacy" lang={asLang((await searchParams).lang)} />;
}
