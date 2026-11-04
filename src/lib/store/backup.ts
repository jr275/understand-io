import { z } from "zod";
import type { Annotation, Block, Gloss, GlossDocument, ReadingProgress } from "@/lib/content/types";
import { resolveAll } from "@/lib/anchors";
import { AnnotationZ, DocumentIdZ, GlossZ, ProgressZ, isWellFormed } from "@/lib/anchors/schema";
import { notebookMarkdown } from "@/components/reader/notebookMarkdown";
import type { LibraryState } from "./library";

/** What a backup file says it is, so a different JSON file is refused with a clear reason. */
export const BACKUP_APP = "understand-io";
export const BACKUP_VERSION = 1;
/** A backup larger than this is refused before it is parsed (the browser keeps the whole library in a few megabytes). */
export const MAX_BACKUP_BYTES = 40 * 1024 * 1024;

const str = (max: number) => z.string().max(max).refine(isWellFormed, "lone surrogate");
/** Only web addresses are ever kept as a link or an image: a file from elsewhere cannot smuggle in `javascript:` or `data:`. */
const WebUrlZ = str(2048).refine((u) => /^https?:\/\//i.test(u), "not a web address");

const RunZ = z.object({ text: str(200_000), em: z.boolean().optional(), strong: z.boolean().optional(), code: z.boolean().optional(), href: WebUrlZ.optional() });
const BlockZ = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(["p", "h2", "h3", "quote", "li", "pre", "note", "figure", "table"]),
  n: z.number().int().min(0).max(1_000_000).optional(),
  text: str(500_000),
  runs: z.array(RunZ).max(5000).optional(),
  src: WebUrlZ.optional(),
  alt: str(1000).optional(),
});
const DocZ = z.object({
  slug: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
  kind: z.enum(["url", "pdf", "text", "sample", "link"]),
  title: str(500),
  author: str(300).nullish(),
  dek: str(2000).nullish(),
  year: z.number().int().min(-5000).max(3000).nullish(),
  sourceUrl: WebUrlZ.nullish(),
  sourceLabel: str(300).nullish(),
  topic: str(40),
  minutes: z.number().min(0).max(100_000),
  paragraphs: z.number().int().min(0).max(1_000_000),
  blocks: z.array(BlockZ).min(1).max(50_000),
  favourite: z.boolean().optional(),
  createdAt: str(40).optional(),
  updatedAt: str(40).optional(),
});

const BackupZ = z.object({
  app: z.literal(BACKUP_APP),
  version: z.literal(BACKUP_VERSION),
  exportedAt: str(40),
  docs: z.array(DocZ).max(5000),
  progress: z.record(DocumentIdZ, ProgressZ),
  annotations: z.record(DocumentIdZ, z.array(AnnotationZ).max(20_000)),
  glosses: z.record(DocumentIdZ, z.array(GlossZ).max(5000)),
});

export interface Backup {
  app: typeof BACKUP_APP;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  docs: GlossDocument[];
  progress: Record<string, ReadingProgress>;
  annotations: Record<string, Annotation[]>;
  glosses: Record<string, Gloss[]>;
}

type Source = Pick<LibraryState, "docs" | "progress" | "annotations" | "glosses">;

const isLocalOnly = (d: GlossDocument) => d.blocks.length > 0 && !!d.id?.startsWith("local:");

/**
 * Everything that lives only in this browser: the texts saved here (with their words), and the reading positions, highlights,
 * notes and questions for them and for the sample texts. Texts kept on the signed-in account are already safe there, so only
 * their marks are not repeated. The client-only sync markers are dropped: they mean nothing in another browser.
 */
export function buildBackup(state: Source, now: Date = new Date()): Backup {
  const docs = Object.values(state.docs).filter(isLocalOnly);
  const ids = new Set([...docs.map((d) => d.id as string), ...Object.keys(state.annotations), ...Object.keys(state.glosses), ...Object.keys(state.progress)].filter((id) => id.startsWith("local:") || id.startsWith("sample:")));
  const pick = <T>(from: Record<string, T[]>) => {
    const out: Record<string, T[]> = {};
    for (const id of ids) if (from[id]?.length) out[id] = from[id];
    return out;
  };
  const progress: Record<string, ReadingProgress> = {};
  for (const id of ids) if (state.progress[id]) progress[id] = state.progress[id];
  const strip = <T extends { syncedAt?: number }>(x: T): T => {
    const { syncedAt: _s, ...rest } = x;
    void _s;
    return rest as T;
  };
  const annotations = Object.fromEntries(Object.entries(pick(state.annotations)).map(([k, v]) => [k, v.map(strip)]));
  const glosses = Object.fromEntries(Object.entries(pick(state.glosses)).map(([k, v]) => [k, v.filter((g) => g.status !== "streaming").map(strip)]));
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    docs,
    progress,
    annotations,
    glosses,
  };
}

export type ParseResult = { ok: true; backup: Backup } | { ok: false; error: string };

/** Reads a backup file's text. Refuses anything that is not exactly a backup, with the first reason found. */
export function parseBackup(raw: string): ParseResult {
  if (raw.length > MAX_BACKUP_BYTES) return { ok: false, error: "That file is too large to be a backup." };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That file is not a backup (it is not valid JSON)." };
  }
  if (!json || typeof json !== "object" || (json as { app?: unknown }).app !== BACKUP_APP) return { ok: false, error: "That file is not a Keeple backup." };
  if ((json as { version?: unknown }).version !== BACKUP_VERSION) return { ok: false, error: "That backup was made by a different version and cannot be read." };
  const r = BackupZ.safeParse(json);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, error: `That backup is damaged (${issue.path.join(".") || "file"}: ${issue.message}). Nothing was restored.` };
  }
  const backup = r.data as unknown as Backup;
  // A text restored here lives in this browser, so its id is always the local one for its slug.
  backup.docs = backup.docs.map((d) => ({ ...d, id: `local:${d.slug}` }));
  return { ok: true, backup };
}

export interface RestorePlan {
  docs: GlossDocument[];
  annotations: Record<string, Annotation[]>;
  glosses: Record<string, Gloss[]>;
  progress: Record<string, ReadingProgress>;
  counts: { docs: number; marks: number; questions: number; positions: number; skippedDocs: number; skippedMarks: number };
}

/**
 * What restoring would change, and nothing else: it only adds. A text whose address is already on the shelf is kept as it is
 * (never replaced), a mark or question already present (same id) is not duplicated, a reading position is taken only when it
 * is newer, and marks for a text that is neither here nor in the backup are left out and counted. Nothing is ever deleted.
 */
export function planRestore(current: Source, backup: Backup): RestorePlan {
  const have = new Set(Object.keys(current.docs));
  const docs = backup.docs.filter((d) => !have.has(d.slug));
  const known = new Set<string>([...Object.values(current.docs).map((d) => d.id ?? ""), ...docs.map((d) => d.id as string)]);
  const accepts = (id: string) => id.startsWith("sample:") || known.has(id);

  const annotations: Record<string, Annotation[]> = {};
  const glosses: Record<string, Gloss[]> = {};
  const progress: Record<string, ReadingProgress> = {};
  let marks = 0;
  let questions = 0;
  let skippedMarks = 0;
  for (const [id, list] of Object.entries(backup.annotations)) {
    if (!accepts(id)) {
      skippedMarks += list.length;
      continue;
    }
    const exists = new Set((current.annotations[id] ?? []).map((a) => a.id));
    const fresh = list.filter((a) => !exists.has(a.id));
    if (fresh.length) annotations[id] = fresh;
    marks += fresh.length;
  }
  for (const [id, list] of Object.entries(backup.glosses)) {
    if (!accepts(id)) continue;
    const exists = new Set((current.glosses[id] ?? []).map((g) => g.id));
    const fresh = list.filter((g) => !exists.has(g.id));
    if (fresh.length) glosses[id] = fresh;
    questions += fresh.length;
  }
  for (const [id, p] of Object.entries(backup.progress)) {
    if (!accepts(id)) continue;
    const cur = current.progress[id];
    if (!cur || p.updatedAt > cur.updatedAt) progress[id] = p;
  }
  return { docs, annotations, glosses, progress, counts: { docs: docs.length, marks, questions, positions: Object.keys(progress).length, skippedDocs: backup.docs.length - docs.length, skippedMarks } };
}

/** The reader's whole notebook as one Markdown file: every text that has highlights, notes or questions, in turn. */
export function allNotesMarkdown(state: Source, textsOf: (doc: GlossDocument) => Block[] = (d) => d.blocks): string {
  const parts: string[] = [];
  for (const d of Object.values(state.docs)) {
    const id = d.id ?? "";
    const blocks = textsOf(d);
    const anns = state.annotations[id] ?? [];
    const gl = (state.glosses[id] ?? []).filter((g) => g.status !== "streaming");
    if (!blocks.length || (!anns.length && !gl.length)) continue;
    parts.push(notebookMarkdown({ doc: d, blocks, annotations: resolveAll(blocks, anns), glosses: resolveAll(blocks, gl) }).trimEnd());
  }
  return parts.length ? `${parts.join("\n\n---\n\n")}\n` : "";
}
