// SEC-11: unexpected errors never reach the client or the log with their SQL, parameters or document text.
// The route test runs against the real local PostgreSQL (DATABASE_URL from .env.local) and provokes a real driver error;
// only the Next request context (cookies) is stubbed. It is skipped when no database is configured.
import dotenv from "dotenv";
import { eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

dotenv.config({ path: ".env.local", quiet: true });

const setCookies: string[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: (_name: string, value: string) => setCookies.push(value), delete: () => {} }),
}));

import { ReadError } from "@/lib/content/errors";
import { getDb } from "@/lib/db/client";
import { documents, readers } from "@/lib/db/schema";
import { importErrorResponse } from "@/lib/server/importErrors";
import { UnsafeUrlError } from "@/lib/server/safeFetch";

describe("importErrorResponse", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("shows messages written for the reader", async () => {
    const a = importErrorResponse(new ReadError("That PDF has 900 pages; the limit is 500."), "fallback");
    expect(a.status).toBe(422);
    expect(await a.json()).toEqual({ error: "That PDF has 900 pages; the limit is 500." });
    const b = importErrorResponse(new UnsafeUrlError("Only public links can be read."), "fallback");
    expect(b.status).toBe(400);
    expect((await b.json()).error).toBe("Only public links can be read.");
  });
  it("replaces everything else with the fixed fallback and logs only the error name", async () => {
    const leaky = Object.assign(new RangeError('Failed query: insert into "documents" ("blocks") values ($1) params: [{"text":"MY PRIVATE NOTES"}]'), { code: "XX000" });
    const res = importErrorResponse(leaky, "Could not read that file.");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not read that file." });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("RangeError");
    expect(logged).not.toMatch(/MY PRIVATE NOTES|insert into/);
  });
  it("treats a fetch TypeError as unreachable only on routes that fetch", async () => {
    expect((await importErrorResponse(new TypeError("fetch failed"), "x", true).json()).error).toBe("That page could not be reached.");
    expect((await importErrorResponse(new TypeError("Cannot read properties of undefined (reading 'x')"), "Could not read that file.").json()).error).toBe("Could not read that file.");
    const timeout = importErrorResponse(Object.assign(new Error("signal timed out"), { name: "TimeoutError" }), "x", true);
    expect(timeout.status).toBe(504);
  });
});

const db = process.env.DATABASE_URL ? getDb() : null;

describe.skipIf(!db)("a real database failure while importing text", () => {
  const readersMade: string[] = [];
  afterAll(async () => {
    if (!db) return;
    for (const v of setCookies) readersMade.push(v.split(".")[0]);
    for (const id of new Set(readersMade)) await db.delete(readers).where(eq(readers.id, id)); // cascades to anything created for it
    await db.delete(documents).where(like(documents.title, "sectest-sec11-%"));
    await db.$client.end({ timeout: 2 });
    globalThis.__glossDb = undefined;
  });

  it("answers with a fixed message and logs a one-line summary, never the SQL or the document", async () => {
    const { POST } = await import("@/app/api/import/text/route");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // jsonb cannot store U+0000, so PostgreSQL itself rejects this insert (22P05).
      const text = `# sectest-sec11-${Date.now()}\n\nSECRET-DOCUMENT-TEXT\u0000 and more words so that the paragraph is a paragraph.`;
      const res = await POST(new Request("http://localhost/api/import/text", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }));
      const body = await res.text();
      expect(res.status).toBe(422);
      expect(JSON.parse(body).error).toBe("Could not save that to your library.");
      const logged = JSON.stringify([...err.mock.calls, ...warn.mock.calls].map((c) => c.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x)))));
      expect(logged).toMatch(/saving a document failed \(code 22P05\)/);
      expect(logged).not.toMatch(/SECRET-DOCUMENT-TEXT|insert into|params|\$1/i);
      expect(err.mock.calls.flat().some((x) => x instanceof Error)).toBe(false); // no error object (it carries the statement) was logged
    } finally {
      err.mockRestore();
      warn.mockRestore();
    }
  });
});
