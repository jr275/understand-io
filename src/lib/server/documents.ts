import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { documents, readers } from "@/lib/db/schema";
import type { GlossDocument } from "@/lib/content/types";
import { getSample } from "@/lib/content/samples";
import { newId } from "@/lib/content/slug";

export function rowToDoc(r: typeof documents.$inferSelect): GlossDocument {
  return {
    id: r.id,
    slug: r.slug,
    kind: r.kind,
    title: r.title,
    author: r.author,
    dek: r.dek,
    year: r.year,
    sourceUrl: r.sourceUrl,
    sourceLabel: r.sourceLabel,
    topic: r.topic,
    minutes: r.minutes,
    paragraphs: r.blocks.filter((b) => b.n).length,
    blocks: r.blocks,
    favourite: !!r.favourite,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Sample first, then the reader's own documents (when a database is configured). */
export async function loadDocument(slug: string, readerId: string | null): Promise<GlossDocument | null> {
  const sample = getSample(slug);
  if (sample) return sample;
  const db = getDb();
  if (!db || !readerId) return null;
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.slug, slug), eq(documents.readerId, readerId)))
    .limit(1);
  return rows[0] ? rowToDoc(rows[0]) : null;
}

export async function listDocuments(readerId: string | null): Promise<Omit<GlossDocument, "blocks">[]> {
  const db = getDb();
  if (!db || !readerId) return [];
  const rows = await db.select().from(documents).where(eq(documents.readerId, readerId)).orderBy(desc(documents.updatedAt));
  return rows.map((r) => {
    const d = rowToDoc(r);
    const { blocks: _blocks, ...meta } = d;
    void _blocks;
    return meta;
  });
}

export async function saveDocument(readerId: string, doc: GlossDocument): Promise<GlossDocument & { persisted: boolean }> {
  const db = getDb();
  if (!db) return { ...doc, id: doc.id ?? `local:${doc.slug}`, persisted: false };
  await db.insert(readers).values({ id: readerId }).onConflictDoNothing();
  const id = doc.id ?? newId();
  const [row] = await db
    .insert(documents)
    .values({
      id,
      readerId,
      slug: doc.slug,
      kind: doc.kind,
      title: doc.title,
      author: doc.author ?? null,
      dek: doc.dek ?? null,
      year: doc.year ?? null,
      sourceUrl: doc.sourceUrl ?? null,
      sourceLabel: doc.sourceLabel ?? null,
      topic: doc.topic,
      minutes: doc.minutes,
      blocks: doc.blocks,
    })
    .returning();
  return { ...rowToDoc(row), persisted: true };
}
