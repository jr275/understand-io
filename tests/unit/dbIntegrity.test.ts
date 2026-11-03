// The read-only integrity check (scripts/lib/integrity.mjs) against the real local PostgreSQL (DATABASE_URL). Everything is written inside one transaction that is
// always rolled back, so nothing is left in the database, and every assertion is a difference from what was there before.
import { describe, expect, it } from "vitest";
import postgres from "postgres";
// A plain .mjs module, shared with the command-line script.
import { integrityReport, problemCount } from "../../scripts/lib/integrity.mjs";

type Report = Awaited<ReturnType<typeof integrityReport>>;
const url = process.env.DATABASE_URL;
class Rollback extends Error {
  constructor(public result: unknown) {
    super("rollback");
  }
}
const run = `it${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!url)("the integrity check (real PostgreSQL)", () => {
  it("finds orphaned marks, glosses and positions and rows on another reader's document, ignores samples, and counts duplicates", async () => {
    const sql = postgres(url!, { prepare: false, max: 1 });
    try {
      const outcome = await sql
        .begin(async (tx) => {
          const before = await integrityReport(tx);
          const [a, b] = [`r_${run}a`, `r_${run}b`];
          await tx`INSERT INTO readers (id) VALUES (${a}), (${b})`;
          const doc = (id: string, reader: string, slug: string, hash: string) =>
            tx`INSERT INTO documents (id, reader_id, slug, kind, title, blocks, content_hash) VALUES (${id}, ${reader}, ${slug}, 'text', 't', ${tx.json([])}, ${hash})`;
          await doc(`d_${run}1`, a, `${run}-1`, `h_${run}`);
          await doc(`d_${run}2`, a, `${run}-2`, `h_${run}`); // the same text saved twice by the same reader
          const mark = (id: string, documentId: string, reader: string) =>
            tx`INSERT INTO annotations (id, document_id, reader_id, kind, anchor) VALUES (${id}, ${documentId}, ${reader}, 'highlight', ${tx.json({})})`;
          await mark(`m_${run}ok`, `d_${run}1`, a); // fine
          await mark(`m_${run}sample`, "sample:walden-reading", a); // fine: samples have no row
          await mark(`m_${run}orphan`, `d_${run}gone`, a); // the document does not exist
          await mark(`m_${run}foreign`, `d_${run}1`, b); // b's mark on a's document
          await tx`INSERT INTO glosses (id, document_id, reader_id, action, turns) VALUES (${"g_" + run}, ${`d_${run}gone`}, ${a}, 'ask', ${tx.json([])})`;
          await tx`INSERT INTO reading_progress (document_id, reader_id) VALUES (${`d_${run}gone`}, ${a}), (${"sample:walden-reading"}, ${a})`;
          const after = await integrityReport(tx);
          throw new Rollback({ before, after });
        })
        .catch((e) => {
          if (e instanceof Rollback) return e.result as { before: Report; after: Report };
          throw e;
        });
      const { before, after } = outcome;
      expect(after.children.annotations.orphans - before.children.annotations.orphans).toBe(1);
      expect(after.children.annotations.foreignOwner - before.children.annotations.foreignOwner).toBe(1);
      expect(after.children.annotations.total - before.children.annotations.total).toBe(4);
      expect(after.children.glosses.orphans - before.children.glosses.orphans).toBe(1);
      expect(after.children.reading_progress.orphans - before.children.reading_progress.orphans).toBe(1);
      expect(after.children.reading_progress.total - before.children.reading_progress.total).toBe(2);
      expect(problemCount(after) - problemCount(before)).toBe(4);
      expect(after.duplicates.groups - before.duplicates.groups).toBe(1);
      expect(after.readers.total - before.readers.total).toBe(2);
      expect(after.sizes.length).toBeGreaterThan(5);
      // Rolled back: the rows are gone.
      expect((await sql`SELECT count(*)::int AS n FROM readers WHERE id LIKE ${"r_" + run + "%"}`)[0].n).toBe(0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
