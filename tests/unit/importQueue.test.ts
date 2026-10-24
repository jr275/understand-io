import { describe, expect, it, vi } from "vitest";
import { ImportQueue, QUEUE_LIMITS, summaryLine, type BatchSummary, type Send, type SendResult } from "@/lib/store/importQueue";
import type { GlossDocument } from "@/lib/content/types";

const file = (name: string) => new File(["x"], name);
const doc = (name: string): GlossDocument => ({ slug: `slug-${name}`, kind: "text", title: `Title ${name}`, author: null, topic: "unsorted", minutes: 1, paragraphs: 1, blocks: [] });
const ok = (name: string, over: Partial<SendResult> = {}): SendResult => ({ document: doc(name), persisted: true, ...over });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A send whose answers the test releases one by one. */
function controlled() {
  const pending = new Map<string, { resolve: (r: SendResult) => void; reject: (e: Error) => void; signal: AbortSignal }>();
  const started: string[] = [];
  const send: Send = (f, signal) =>
    new Promise((resolve, reject) => {
      started.push(f.name);
      pending.set(f.name, { resolve, reject, signal });
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  return { send, pending, started };
}

describe("ImportQueue", () => {
  it("sends two files at a time and starts the next as soon as one finishes", async () => {
    const c = controlled();
    const q = new ImportQueue(c.send);
    q.add(["a", "b", "c", "d"].map(file));
    await tick();
    expect(c.started).toEqual(["a", "b"]);
    expect(q.items.map((i) => i.state)).toEqual(["sending", "sending", "waiting", "waiting"]);
    c.pending.get("a")!.resolve(ok("a"));
    await tick();
    expect(c.started).toEqual(["a", "b", "c"]);
    expect(q.items.map((i) => i.state)).toEqual(["done", "sending", "sending", "waiting"]);
  });

  it("gives every file its own outcome: one failing leaves the others saved", async () => {
    const results: string[] = [];
    const summaries: BatchSummary[] = [];
    const c = controlled();
    const q = new ImportQueue(c.send, { onResult: (i) => results.push(i.name), onBatchDone: (s) => summaries.push(s) });
    q.add(["good1", "bad", "good2"].map(file));
    await tick();
    c.pending.get("good1")!.resolve(ok("good1"));
    c.pending.get("bad")!.reject(new Error("Nothing readable in that file."));
    await tick();
    c.pending.get("good2")!.resolve(ok("good2"));
    await tick();
    expect(q.items.map((i) => [i.name, i.state])).toEqual([["good1", "done"], ["bad", "failed"], ["good2", "done"]]);
    expect(q.items[1].error).toBe("Nothing readable in that file.");
    expect(results).toEqual(["good1", "good2"]); // only saved files are reported as results
    expect(summaries).toEqual([{ total: 3, done: 2, duplicate: 0, failed: 1, cancelled: 0 }]); // once, when the batch is over
    expect(summaryLine(summaries[0])).toBe("2 of 3 imported, 1 failed.");
  });

  it("shows a text that was already saved as a duplicate, pointing at the saved one", async () => {
    const q = new ImportQueue(async (f) => ok(f.name, { duplicate: true }));
    q.add([file("again")]);
    await tick();
    expect(q.items[0]).toMatchObject({ state: "duplicate", slug: "slug-again", title: "Title again" });
    expect(summaryLine({ total: 2, done: 1, duplicate: 1, failed: 0, cancelled: 0 })).toBe("1 of 2 imported, 1 already in your library.");
  });

  it("refuses a file nothing can read at once, without sending it", async () => {
    const send = vi.fn(async (f: File) => ok(f.name));
    const q = new ImportQueue(send, {}, 2, (f) => (f.name.endsWith(".gif") ? "Only PDF, text, Word, EPUB and HTML files can be imported." : null));
    q.add([file("pic.gif"), file("notes.txt")]);
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.items.map((i) => [i.name, i.state])).toEqual([["pic.gif", "failed"], ["notes.txt", "done"]]);
    expect(q.items[0].error).toMatch(/Only PDF/);
  });

  it("cancels a file that is waiting, and stops one that is being sent", async () => {
    const c = controlled();
    const q = new ImportQueue(c.send, {}, 1);
    q.add(["first", "second"].map(file));
    await tick();
    q.cancel(q.items[1].id); // still waiting
    expect(q.items[1].state).toBe("cancelled");
    q.cancel(q.items[0].id); // being sent
    await tick();
    expect(c.pending.get("first")!.signal.aborted).toBe(true);
    expect(q.items.map((i) => i.state)).toEqual(["cancelled", "cancelled"]);
    expect(c.started).toEqual(["first"]); // the cancelled one never started
  });

  it("cancelAll stops everything not yet over and leaves finished files alone", async () => {
    const c = controlled();
    const q = new ImportQueue(c.send, {}, 1);
    q.add(["a", "b", "c"].map(file));
    await tick();
    c.pending.get("a")!.resolve(ok("a"));
    await tick();
    q.cancelAll();
    await tick();
    expect(q.items.map((i) => i.state)).toEqual(["done", "cancelled", "cancelled"]);
  });

  it("retries a failed or cancelled file by sending it again", async () => {
    let attempt = 0;
    const send = vi.fn(async (f: File) => {
      attempt += 1;
      if (attempt === 1) throw new Error("The network dropped.");
      return ok(f.name);
    });
    const q = new ImportQueue(send);
    q.add([file("flaky")]);
    await tick();
    expect(q.items[0]).toMatchObject({ state: "failed", error: "The network dropped." });
    q.retry(q.items[0].id);
    await tick();
    expect(q.items[0]).toMatchObject({ state: "done", error: undefined });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not retry a file that already succeeded, or one it never sent", async () => {
    const send = vi.fn(async (f: File) => ok(f.name));
    const q = new ImportQueue(send, {}, 2, (f) => (f.name === "x.gif" ? "refused" : null));
    q.add([file("a.txt"), file("x.gif")]);
    await tick();
    q.retry(q.items[0].id); // done
    q.retry(q.items[1].id); // refused up front: there is nothing to send
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps a batch to the limit and says how many were left out", () => {
    const q = new ImportQueue(() => new Promise(() => {}));
    const r = q.add(Array.from({ length: QUEUE_LIMITS.files + 5 }, (_, i) => file(`f${i}`)));
    expect(r).toEqual({ added: QUEUE_LIMITS.files, skipped: 5 });
    expect(q.items).toHaveLength(QUEUE_LIMITS.files);
  });

  it("clears only finished files", async () => {
    const c = controlled();
    const q = new ImportQueue(c.send, {}, 1);
    q.add(["a", "b"].map(file));
    await tick();
    c.pending.get("a")!.resolve(ok("a"));
    await tick();
    q.clearFinished();
    expect(q.items.map((i) => i.name)).toEqual(["b"]);
  });

  it("tells subscribers about every change, and a fresh array each time", async () => {
    const q = new ImportQueue(async (f) => ok(f.name));
    const seen: unknown[] = [];
    q.subscribe(() => seen.push(q.items));
    q.add([file("a")]);
    await tick();
    expect(seen.length).toBeGreaterThanOrEqual(3); // added, sending, done
    expect(new Set(seen).size).toBe(seen.length);
  });
});
