import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isConnectionError } from "@/lib/server/dbErrors";

/**
 * Real outage, no mocks: DATABASE_URL points at a local port nothing listens on, so postgres.js and
 * drizzle produce the same ECONNREFUSED failure that crashed /library with a 500.
 */
beforeAll(() => {
  process.env.DATABASE_URL = "postgres://127.0.0.1:1/gloss";
});
afterEach(() => vi.restoreAllMocks());

describe("server documents while the database is unreachable", () => {
  it("lists nothing and reports persisted:false instead of throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { listDocuments } = await import("@/lib/server/documents");
    const r = await listDocuments("r_outage_test");
    expect(r).toEqual({ documents: [], persisted: false });
    // The log line names the failure but never carries SQL or the reader id.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("ECONNREFUSED");
    expect(String(warn.mock.calls[0][0])).not.toMatch(/select|r_outage_test/i);
  });

  it("still serves samples, and flags a missing own document as unavailable rather than not found", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadDocumentResult } = await import("@/lib/server/documents");
    const sample = await loadDocumentResult("on-a-piece-of-chalk", "r_outage_test");
    expect(sample.doc?.title).toBe("On a Piece of Chalk");
    expect(sample.unavailable).toBe(false);
    const own = await loadDocumentResult("an-imported-text-abc12", "r_outage_test");
    expect(own).toEqual({ doc: null, unavailable: true });
  });

  it("keeps an import local-first: the document is returned with persisted:false and all its blocks", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { saveDocument } = await import("@/lib/server/documents");
    const { documentFromText } = await import("@/lib/content/text");
    const doc = documentFromText("# Written during an outage\n\nFirst paragraph.\n\nSecond paragraph.");
    const saved = await saveDocument("r_outage_test", doc);
    expect(saved.persisted).toBe(false);
    expect(saved.id).toBe(`local:${doc.slug}`);
    expect(saved.blocks).toHaveLength(2);
  });
});

describe("isConnectionError", () => {
  it("recognises the exact shape logged by the crash: a drizzle error wrapping an AggregateError", () => {
    const refused = (address: string) => Object.assign(new Error(`connect ECONNREFUSED ${address}:5432`), { code: "ECONNREFUSED", errno: -61, syscall: "connect", address, port: 5432 });
    const aggregate = Object.assign(new AggregateError([refused("::1"), refused("127.0.0.1")], ""), { code: "ECONNREFUSED" });
    const drizzle = Object.assign(new Error("Failed query: select ..."), { cause: aggregate });
    expect(isConnectionError(drizzle)).toBe(true);
    // Also when only the inner errors carry the code.
    expect(isConnectionError({ cause: { errors: [{ code: "ETIMEDOUT" }] } })).toBe(true);
    expect(isConnectionError({ code: "57P03" })).toBe(true);
    expect(isConnectionError({ code: "CONNECT_TIMEOUT" })).toBe(true);
  });

  it("does not mistake data or programming errors for an outage", () => {
    expect(isConnectionError(new Error("boom"))).toBe(false);
    expect(isConnectionError({ code: "23505" })).toBe(false); // unique violation
    expect(isConnectionError({ code: "42P01", cause: { code: "42703" } })).toBe(false); // missing table / column
    expect(isConnectionError(null)).toBe(false);
    expect(isConnectionError("ECONNREFUSED")).toBe(false);
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(isConnectionError(cyclic)).toBe(false); // depth-limited, no infinite loop
  });
});
