import { afterEach, describe, expect, it, vi } from "vitest";
import { guarded } from "@/app/api/annotations/_guard";

/** SEC-11: a database error that is not an outage must not put SQL, parameters or note text into the logs or the response. */
afterEach(() => vi.restoreAllMocks());

describe("guarded()", () => {
  it("answers a fixed 500 and logs only the error code for a non-connection database error", async () => {
    const err = Object.assign(new Error('Failed query: insert into "annotations" (note) values ($1) params: my private note'), { code: "22P02" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await guarded("test", async () => {
      throw err;
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server-error" });
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain("22P02");
    expect(logged).not.toContain("my private note");
    expect(logged).not.toContain("insert into");
  });

  it("still turns a connection failure into the outage answer", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await guarded("test", async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    });
    expect(res.status).toBe(503);
  });

  it("passes a normal response through", async () => {
    const res = await guarded("test", async () => Response.json({ ok: true }));
    expect(await res.json()).toEqual({ ok: true });
  });
});
