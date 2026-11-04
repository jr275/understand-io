import type { Metadata } from "next";
import { getReaderId } from "@/lib/server/reader";
import { listDocuments } from "@/lib/server/documents";
import { LibraryPage } from "@/components/library/LibraryPage";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { NOINDEX } from "@/lib/seo/site";

// A person's own shelf: never for a search engine.
export const metadata: Metadata = { title: "Library", robots: NOINDEX };

export default async function Page() {
  const readerId = await getReaderId();
  const { documents } = await listDocuments(readerId);
  return (
    <>
      <LibraryPage serverDocs={documents} />
      <LegalLinks />
    </>
  );
}
