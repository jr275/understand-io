import type { Metadata } from "next";
import { getReaderId } from "@/lib/server/reader";
import { listDocuments } from "@/lib/server/documents";
import { LibraryPage } from "@/components/library/LibraryPage";

export const metadata: Metadata = { title: "Library" };

export default async function Page() {
  const readerId = await getReaderId();
  const { documents } = await listDocuments(readerId);
  return <LibraryPage serverDocs={documents} />;
}
