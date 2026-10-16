import { getDb } from "@/lib/db/client";
import { getReaderId } from "@/lib/server/reader";
import { listDocuments } from "@/lib/server/documents";

export async function GET() {
  const readerId = await getReaderId();
  const persisted = !!getDb();
  const documents = await listDocuments(readerId);
  return Response.json({ documents, persisted });
}
