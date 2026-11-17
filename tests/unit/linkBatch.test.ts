import { describe, expect, it, vi } from "vitest";
import type { GlossDocument } from "@/lib/content/types";
import { LinkBatch, MAX_LINKS, parseLinks, type Deps, type LinkResult } from "@/lib/client/linkBatch";

const doc = (n: string, extra: Partial<GlossDocument> = {}): GlossDocument => ({ id: `id-${n}`, slug: `slug-${n}`, title: `Title ${n}`, kind: "url", blocks: [], ...extra }) as unknown as GlossDocument;
const ok = (n: string, extra: Partial<LinkResult> = {}): LinkResult => ({ document: doc(n), persisted: true, ...extra });
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(b: LinkBatch) {
  while (b.running) await tick();
}

function make(over: Partial<Deps> = {}) {
  const sent: string[] = [];
  const order: string[] = [];
  const deps: Deps = {
    send: async (url) => (sent.push(url), order.push(`send ${url}`), ok(url.slice(-1))),
    known: () => null,
    ready: async () => void order.push("ready"),
    ...over,
  };
  return { batch: new LinkBatch(deps), sent, order, deps };
}

describe("parseLinks: one link per line", () => {
  it("reads one link, and several in the order written", () => {
    expect(parseLinks("https://example.com/a").urls).toEqual(["https://example.com/a"]);
    expect(parseLinks("https://example.com/1\nhttps://example.com/2\nhttps://example.com/3").urls).toEqual(["https://example.com/1", "https://example.com/2", "https://example.com/3"]);
  });

  it("ignores blank lines and trims spaces, tabs, CRLF and zero-width characters", () => {
    const p = parseLinks("\n  https://example.com/a  \r\n\r\n\t https://example.com/b\t\n\n​https://example.com/c﻿\n");
    expect(p.urls).toEqual(["https://example.com/a", "https://example.com/b", "https://example.com/c"]);
    expect(p.invalid).toEqual([]);
  });

  it("gives a bare domain a scheme and keeps http and https as written", () => {
    expect(parseLinks("example.com/x\nhttp://example.org/y").urls).toEqual(["https://example.com/x", "http://example.org/y"]);
  });

  it("reports what is not a web address with its line number, and still reads the valid ones", () => {
    const p = parseLinks("https://example.com/a\nnot a link\nftp://example.com/file\nmailto:a@b.co\nhttps://example.com/b");
    expect(p.urls).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(p.invalid.map((i) => [i.line, i.why])).toEqual([[2, "invalid"], [3, "scheme"], [4, "scheme"]]);
  });

  it("never splits on commas, spaces or semicolons: a line with two addresses is reported, an address with a comma stays whole", () => {
    const p = parseLinks("https://example.com/a https://example.com/b\nhttps://example.com/a,b\nhttps://example.com/x;y");
    expect(p.invalid.map((i) => i.line)).toEqual([1]);
    expect(p.urls).toEqual(["https://example.com/a,b", "https://example.com/x;y"]);
  });

  it("drops repeats inside the batch (same page by address), keeps the first, and counts them", () => {
    const p = parseLinks("https://example.com/a\nhttps://www.example.com/a/\nhttps://example.com/a?utm_source=x\nhttps://example.com/b\nEXAMPLE.com/a");
    expect(p.urls).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(p.repeated).toBe(3);
  });

  it("keeps different pages that differ only by a real query parameter", () => {
    expect(parseLinks("https://example.com/p?id=1\nhttps://example.com/p?id=2").urls).toHaveLength(2);
  });

  it(`reads at most ${MAX_LINKS} links and says how many were left out`, () => {
    const p = parseLinks(Array.from({ length: MAX_LINKS + 7 }, (_, i) => `https://example.com/${i}`).join("\n"));
    expect(p.urls).toHaveLength(MAX_LINKS);
    expect(p.over).toBe(7);
    expect(p.urls[0]).toBe("https://example.com/0");
  });

  it("truncates a very long invalid line in the report", () => {
    expect(parseLinks("x ".repeat(200)).invalid[0].text.length).toBeLessThanOrEqual(120);
  });
});

describe("LinkBatch", () => {
  it("settles the reader's session once, before the first request, then reads each link in order", async () => {
    const { batch, sent, order } = make();
    expect(batch.start(parseLinks("https://example.com/1\nhttps://example.com/2\nhttps://example.com/3"))).toBe(true);
    await settle(batch);
    expect(order[0]).toBe("ready");
    expect(order.filter((o) => o === "ready")).toHaveLength(1);
    expect(sent).toEqual(["https://example.com/1", "https://example.com/2", "https://example.com/3"]);
    expect(batch.rows.map((r) => r.state)).toEqual(["saved", "saved", "saved"]);
    expect(batch.summary()).toMatchObject({ total: 3, saved: 3, failed: 0, duplicate: 0, done: true, pending: 0 });
  });

  it("sends one request at a time (never two in flight)", async () => {
    let inFlight = 0;
    let peak = 0;
    const { batch } = make({
      send: async (u) => {
        peak = Math.max(peak, ++inFlight);
        await tick();
        inFlight--;
        return ok(u.slice(-1));
      },
    });
    batch.start(parseLinks("https://example.com/1\nhttps://example.com/2\nhttps://example.com/3"));
    await settle(batch);
    expect(peak).toBe(1);
  });

  it("a row is saved only after the server answered", async () => {
    let release!: (r: LinkResult) => void;
    const { batch } = make({ send: () => new Promise<LinkResult>((res) => (release = res)) });
    batch.start(parseLinks("https://example.com/1"));
    await tick();
    expect(batch.rows[0].state).toBe("working");
    expect(batch.summary()).toMatchObject({ saved: 0, pending: 1, done: false, current: "https://example.com/1" });
    release(ok("1"));
    await settle(batch);
    expect(batch.rows[0].state).toBe("saved");
  });

  it("a link already in the library is reported as such and is not sent", async () => {
    const { batch, sent } = make({ known: (u) => (u.endsWith("/2") ? doc("2") : null) });
    batch.start(parseLinks("https://example.com/1\nhttps://example.com/2"));
    await settle(batch);
    expect(sent).toEqual(["https://example.com/1"]);
    expect(batch.rows[1]).toMatchObject({ state: "duplicate", slug: "slug-2" });
    expect(batch.summary()).toMatchObject({ saved: 1, duplicate: 1 });
  });

  it("a duplicate the server recognises counts as already in the library, not as new", async () => {
    const { batch } = make({ send: async () => ok("9", { duplicate: true }) });
    batch.start(parseLinks("https://example.com/9"));
    await settle(batch);
    expect(batch.summary()).toMatchObject({ saved: 0, duplicate: 1 });
  });

  it("a link saved only as a card is kept, marked as such, and counted as saved", async () => {
    const { batch } = make({ send: async () => ok("5", { linkOnly: true, reason: "That site blocks readers like this one." }) });
    batch.start(parseLinks("https://example.com/5"));
    await settle(batch);
    expect(batch.rows[0]).toMatchObject({ state: "link", reason: "That site blocks readers like this one." });
    expect(batch.summary()).toMatchObject({ saved: 1, linkOnly: 1 });
  });

  it("one failure does not stop or undo the others (partial success is kept)", async () => {
    const results: string[] = [];
    const { batch } = make({
      send: async (u) => {
        if (u.endsWith("/2")) throw new Error("The server had a problem. Try again.");
        return ok(u.slice(-1));
      },
      onResult: (r) => void results.push(r.document.slug),
    });
    batch.start(parseLinks("https://example.com/1\nhttps://example.com/2\nhttps://example.com/3"));
    await settle(batch);
    expect(batch.rows.map((r) => r.state)).toEqual(["saved", "failed", "saved"]);
    expect(batch.rows[1].error).toMatch(/server had a problem/);
    expect(results).toEqual(["slug-1", "slug-3"]); // each saved document was handed over as soon as it was confirmed
    expect(batch.summary()).toMatchObject({ saved: 2, failed: 1, done: true });
  });

  it("retry sends only the failed links; the saved ones are not sent again", async () => {
    let failTwo = true;
    const { batch, sent } = make({
      send: async (u) => {
        sent.push(u);
        if (u.endsWith("/2") && failTwo) throw new Error("boom");
        return ok(u.slice(-1));
      },
    });
    batch.start(parseLinks("https://example.com/1\nhttps://example.com/2\nhttps://example.com/3"));
    await settle(batch);
    sent.length = 0;
    failTwo = false;
    expect(batch.retryFailed()).toBe(true);
    await settle(batch);
    expect(sent).toEqual(["https://example.com/2"]);
    expect(batch.rows.map((r) => r.state)).toEqual(["saved", "saved", "saved"]);
    expect(batch.retryFailed()).toBe(false); // nothing left to retry
  });

  it("a second start while one is running is refused: nothing is sent twice", async () => {
    let release!: () => void;
    const send = vi.fn(() => new Promise<LinkResult>((res) => (release = () => res(ok("1")))));
    const { batch } = make({ send });
    const p = parseLinks("https://example.com/1");
    expect(batch.start(p)).toBe(true);
    expect(batch.start(p)).toBe(false);
    expect(batch.retryFailed()).toBe(false);
    await tick();
    release();
    await settle(batch);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("lines that are not web addresses become skipped rows, never requests, and are not retried", async () => {
    const { batch, sent } = make();
    batch.start(parseLinks("https://example.com/1\nnot a link\nftp://x.org/f"));
    await settle(batch);
    expect(sent).toEqual(["https://example.com/1"]);
    expect(batch.rows.map((r) => [r.state, r.error])).toEqual([["saved", undefined], ["skipped", "invalid"], ["skipped", "scheme"]]);
    expect(batch.summary()).toMatchObject({ saved: 1, skipped: 2, failed: 0, done: true });
    expect(batch.retryFailed()).toBe(false);
  });

  it("only invalid lines: nothing is sent and the batch is already done", () => {
    const { batch, sent } = make();
    expect(batch.start(parseLinks("nope"))).toBe(true);
    expect(sent).toEqual([]);
    expect(batch.summary()).toMatchObject({ total: 1, skipped: 1, done: true });
  });

  it("nothing to read: start refuses", () => {
    expect(make().batch.start(parseLinks("  \n\n "))).toBe(false);
  });

  it("a 429 stops the batch: the links not yet tried are failed with the server's words, and Retry picks them up", async () => {
    const limited = Object.assign(new Error("That is more than 60 imports in 10 minutes. Try again in about 5 minutes."), { status: 429 });
    let limit = true;
    const { batch, sent } = make({
      send: async (u) => {
        sent.push(u);
        if (u.endsWith("/2") && limit) throw limited;
        return ok(u.slice(-1));
      },
    });
    batch.start(parseLinks("https://example.com/1\nhttps://example.com/2\nhttps://example.com/3\nhttps://example.com/4"));
    await settle(batch);
    expect(sent).toHaveLength(2); // 3 and 4 were never tried
    expect(batch.rows.map((r) => r.state)).toEqual(["saved", "failed", "failed", "failed"]);
    expect(batch.rows[3].error).toMatch(/more than 60 imports/);
    limit = false;
    sent.length = 0;
    batch.retryFailed();
    await settle(batch);
    expect(sent).toEqual(["https://example.com/2", "https://example.com/3", "https://example.com/4"]);
    expect(batch.summary()).toMatchObject({ saved: 4, failed: 0 });
  });

  it("a failed session bootstrap does not stop the batch: each request answers for itself", async () => {
    const { batch, sent } = make({ ready: async () => Promise.reject(new Error("offline")) });
    batch.start(parseLinks("https://example.com/1"));
    await settle(batch);
    expect(sent).toHaveLength(1);
  });

  it("notifies subscribers on every change and reports the summary when done", async () => {
    const onDone = vi.fn();
    const { batch } = make({ onDone });
    const seen: string[][] = [];
    batch.subscribe(() => seen.push(batch.getSnapshot().map((r) => r.state)));
    batch.start(parseLinks("https://example.com/1\nhttps://example.com/2"));
    await settle(batch);
    expect(seen[0]).toEqual(["waiting", "waiting"]);
    expect(seen.some((s) => s.includes("working"))).toBe(true);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ total: 2, saved: 2, done: true }));
  });

  it("clear empties the list only when nothing is running", async () => {
    const { batch } = make();
    batch.start(parseLinks("https://example.com/1"));
    batch.clear();
    expect(batch.rows).toHaveLength(1);
    await settle(batch);
    batch.clear();
    expect(batch.rows).toHaveLength(0);
  });
});
