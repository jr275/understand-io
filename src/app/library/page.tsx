import type { Metadata } from "next";
import { getReaderId } from "@/lib/server/reader";
import { listDocuments } from "@/lib/server/documents";
import { LibraryPage } from "@/components/library/LibraryPage";
import { LegalLinks } from "@/components/legal/LegalLinks";

export const metadata: Metadata = { title: "Library" };

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
