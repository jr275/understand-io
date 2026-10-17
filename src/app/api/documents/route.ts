import { getReaderId } from "@/lib/server/reader";
import { listDocuments } from "@/lib/server/documents";

export async function GET() {
  const readerId = await getReaderId();
  // `persisted` is false without a database *and* while it is unreachable, so the client never mistakes
  // an outage for "everything was deleted elsewhere".
  const { documents, persisted } = await listDocuments(readerId);
  return Response.json({ documents, persisted });
}
