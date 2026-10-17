import { and, desc, eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import { documents, readers } from "@/lib/db/schema";
import type { GlossDocument } from "@/lib/content/types";
import { ReadError } from "@/lib/content/errors";
import { getSample } from "@/lib/content/samples";
import { newId, slugFor } from "@/lib/content/slug";
import { describeDbError, isConnectionError } from "./dbErrors";

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

export interface LoadResult {
  doc: GlossDocument | null;
  /** True when the database could not be reached, so a missing document is "unknown", not "not found". */
  unavailable: boolean;
}

/** Sample first, then the reader's own documents (when a database is configured and reachable). */
export async function loadDocumentResult(slug: string, readerId: string | null): Promise<LoadResult> {
  const sample = getSample(slug);
  if (sample) return { doc: sample, unavailable: false };
  const db = getDb();
  if (!db || !readerId) return { doc: null, unavailable: false };
  try {
    const rows = await db
      .select()
      .from(documents)
      .where(and(eq(documents.slug, slug), eq(documents.readerId, readerId)))
      .limit(1);
    return { doc: rows[0] ? rowToDoc(rows[0]) : null, unavailable: false };
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    console.warn(`[db] unavailable while loading a document (${describeDbError(err)})`);
    return { doc: null, unavailable: true };
  }
}

export async function loadDocument(slug: string, readerId: string | null): Promise<GlossDocument | null> {
  return (await loadDocumentResult(slug, readerId)).doc;
}

export interface DocumentList {
  documents: Omit<GlossDocument, "blocks">[];
  /** False without a database or while it is unreachable: clients must then keep what they hold locally. */
  persisted: boolean;
}

export async function listDocuments(readerId: string | null): Promise<DocumentList> {
  const db = getDb();
  if (!db) return { documents: [], persisted: false };
  if (!readerId) return { documents: [], persisted: true };
  try {
    const rows = await db.select().from(documents).where(eq(documents.readerId, readerId)).orderBy(desc(documents.updatedAt));
    return {
      persisted: true,
      documents: rows.map((r) => {
        const d = rowToDoc(r);
        const { blocks: _blocks, ...meta } = d;
        void _blocks;
        return meta;
      }),
    };
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    console.warn(`[db] unavailable while listing documents (${describeDbError(err)})`);
    return { documents: [], persisted: false };
  }
}

export async function saveDocument(readerId: string, doc: GlossDocument): Promise<GlossDocument & { persisted: boolean }> {
  const local = { ...doc, id: doc.id ?? `local:${doc.slug}`, persisted: false };
  const db = getDb();
  if (!db) return local;
  try {
    await db.insert(readers).values({ id: readerId }).onConflictDoNothing();
    const id = doc.id ?? newId();
    let slug = doc.slug;
    for (let attempt = 0; ; attempt++) {
      try {
        return await insertDocument(db, { ...doc, slug }, id, readerId);
      } catch (err) {
        const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
        if (code === "23505" && attempt < 3) {
          slug = slugFor(doc.title); // another reader already owns this slug: pick a new suffix
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    if (isConnectionError(err)) {
      // Local-first: the import still succeeds and the browser keeps the document until the database is back.
      console.warn(`[db] unavailable while saving a document; kept local (${describeDbError(err)})`);
      return local;
    }
    // Drizzle error messages embed the SQL and its parameters (the whole document): never log or send the error object.
    console.error(`[db] saving a document failed (${describeDbError(err)})`);
    throw new ReadError("Could not save that to your library.");
  }
}

async function insertDocument(db: Db, doc: GlossDocument, id: string, readerId: string): Promise<GlossDocument & { persisted: boolean }> {
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
