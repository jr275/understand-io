import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Migration 0007 (analytics) is applied automatically by the production build, so what it may contain is held to a rule here: it creates the new
 * table and its indexes and does nothing else. It cannot drop, alter, update, delete or insert, and it names no other table.
 */
const sql = readFileSync("drizzle/0007_analytics_events.sql", "utf8");
const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

describe("migration 0007_analytics_events", () => {
  it("is exactly one CREATE TABLE and its CREATE INDEXes, on analytics_events only", () => {
    expect(statements.length).toBeGreaterThanOrEqual(2);
    expect(statements[0]).toMatch(/^CREATE TABLE "analytics_events" \(/);
    for (const s of statements.slice(1)) expect(s, s).toMatch(/^CREATE INDEX "analytics_events_[a-z_]+" ON "analytics_events" USING btree /);
  });

  it("has no destructive or data-changing statement", () => {
    for (const word of ["DROP", "ALTER", "UPDATE", "DELETE", "INSERT", "TRUNCATE", "GRANT", "REVOKE", "RENAME", "REPLACE", "CASCADE", "COPY"]) {
      expect(sql, word).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
    }
  });

  it("refers to no existing table (no foreign key into the reader's data)", () => {
    expect(sql).not.toMatch(/REFERENCES|FOREIGN KEY/i);
    for (const t of ["readers", "documents", "annotations", "glosses", "reading_progress", "settings", "accounts", "rate_hits", "ai_ledger", "ai_reservations", "ai_leases"]) {
      expect(sql, t).not.toContain(`"${t}"`);
    }
  });

  it("is the last entry of the journal, after 0006, and nothing was rewritten before it", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string }[] };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags.slice(-2)).toEqual(["0006_ai_budget", "0007_analytics_events"]);
    expect(journal.entries.map((e) => e.idx)).toEqual(tags.map((_, i) => i));
  });
});
