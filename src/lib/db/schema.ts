import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Anchor, Block, GlossTurn } from "@/lib/content/types";

export const readers = pgTable("readers", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    readerId: text("reader_id")
      .notNull()
      .references(() => readers.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    kind: text("kind").$type<"url" | "pdf" | "text" | "sample">().notNull(),
    title: text("title").notNull(),
    author: text("author"),
    dek: text("dek"),
    year: integer("year"),
    sourceUrl: text("source_url"),
    sourceLabel: text("source_label"),
    topic: text("topic").notNull().default("unsorted"),
    minutes: integer("minutes").notNull().default(1),
    blocks: jsonb("blocks").$type<Block[]>().notNull(),
    favourite: integer("favourite").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("documents_slug_idx").on(t.slug), index("documents_reader_idx").on(t.readerId)],
);

export const readingProgress = pgTable(
  "reading_progress",
  {
    documentId: text("document_id").notNull(),
    readerId: text("reader_id")
      .notNull()
      .references(() => readers.id, { onDelete: "cascade" }),
    blockId: text("block_id"),
    ratio: real("ratio").notNull().default(0),
    finished: integer("finished").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.readerId] })],
);

export const annotations = pgTable(
  "annotations",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    readerId: text("reader_id")
      .notNull()
      .references(() => readers.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"highlight" | "underline" | "note">().notNull(),
    color: text("color").$type<"yellow" | "green" | "blue" | "pink">(),
    note: text("note"),
    anchor: jsonb("anchor").$type<Anchor>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("annotations_doc_idx").on(t.documentId, t.readerId)],
);

export const glosses = pgTable(
  "glosses",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    readerId: text("reader_id")
      .notNull()
      .references(() => readers.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    anchor: jsonb("anchor").$type<Anchor | null>(),
    turns: jsonb("turns").$type<GlossTurn[]>().notNull(),
    model: text("model"),
    usage: jsonb("usage").$type<{ input: number; output: number; cost?: number } | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("glosses_doc_idx").on(t.documentId, t.readerId)],
);

export const settings = pgTable("settings", {
  readerId: text("reader_id")
    .primaryKey()
    .references(() => readers.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
