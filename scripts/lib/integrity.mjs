// The read-only questions the integrity check asks of the database. Takes a postgres.js client (or a transaction); never writes, never prints a connection string.
//
// Why "orphan" means what it means here: annotations, glosses and reading positions point at `document_id` with no foreign key, on purpose. A built-in sample
// ("sample:<slug>") has no row in `documents`, so a key could not express the rule; `canAttachTo` in src/lib/server/documents.ts is the guarantee, and the document
// DELETE route removes the children in one transaction. What can still leave a child behind: a delete that races a save of a mark, a manual SQL delete, or a restore.

const CHILDREN = [
  ["annotations", "annotations"],
  ["glosses", "glosses"],
  ["reading_progress", "reading positions"],
];

export async function integrityReport(sql) {
  /** @type {Record<string, { label: string; orphans: number; foreignOwner: number; total: number }>} */
  const children = {};
  for (const [table, label] of CHILDREN) {
    // Table names come from the constant above, never from input.
    const [row] = await sql.unsafe(`
      SELECT
        count(*) FILTER (WHERE c.document_id NOT LIKE 'sample:%' AND d.id IS NULL)::int AS orphans,
        count(*) FILTER (WHERE c.document_id NOT LIKE 'sample:%' AND d.id IS NOT NULL AND d.reader_id <> c.reader_id)::int AS "foreignOwner",
        count(*)::int AS total
      FROM ${table} c LEFT JOIN documents d ON d.id = c.document_id`);
    children[table] = { label, ...row };
  }

  const [dups] = await sql`
    SELECT count(*)::int AS groups, coalesce(sum(n - 1), 0)::int AS "extraRows"
    FROM (SELECT count(*) AS n FROM documents WHERE content_hash IS NOT NULL GROUP BY reader_id, content_hash HAVING count(*) > 1) g`;

  const [readers] = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.reader_id = r.id))::int AS anonymous,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.reader_id = r.id)
                              AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.reader_id = r.id))::int AS "anonymousWithoutDocuments",
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.reader_id = r.id)
                              AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.reader_id = r.id)
                              AND r.created_at < now() - interval '30 days')::int AS "emptyAnonymousOver30Days",
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.reader_id = r.id) AND r.created_at < now() - interval '90 days')::int AS "anonymousOver90Days"
    FROM readers r`;

  const sizes = await sql`
    SELECT relname AS "table", pg_total_relation_size(c.oid)::bigint AS bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND relname IN ('readers','documents','annotations','glosses','reading_progress','settings','accounts','rate_hits','ai_ledger','ai_reservations','ai_leases')
    ORDER BY bytes DESC`;

  return { children, duplicates: dups, readers, sizes: sizes.map((s) => ({ table: s.table, bytes: Number(s.bytes) })) };
}

/** Orphans and rows attached to another reader's document are defects; duplicates and old anonymous readers are only reported. */
export const problemCount = (r) => Object.values(r.children).reduce((n, c) => n + c.orphans + c.foreignOwner, 0);
