// SEC-1 / SEC-11: the server's Together key must not be an open proxy. Routes are called directly with real
// Request objects; the only thing replaced is global fetch (the provider), so nothing ever leaves the machine.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS, SERVER_KEY_ERROR, limitHistory } from "@/lib/ai/requestLimits";
import { SlidingWindowLimiter, limitFor, resetRateLimits, setSharedCounter } from "@/lib/server/rateLimit";
import { READER_COOKIE, readerCookieValue } from "@/lib/server/reader";

const realFetch = globalThis.fetch;
let upstream: ReturnType<typeof vi.fn>;
let ipCounter = 0;
const ip = () => `198.51.100.${(ipCounter = (ipCounter + 1) % 250)}`;

beforeEach(() => {
  process.env.TOGETHER_API_KEY = "test-server-key";
  delete process.env.GLOSS_RATE_GLOSS;
  delete process.env.GLOSS_RATE_SEARCH;
  delete process.env.GLOSS_RATE_TRANSCRIBE;
  delete process.env.GLOSS_RATE_WINDOW_SEC;
  setSharedCounter(null); // the per-process layer is under test here; the shared layer has its own tests
  resetRateLimits();
  upstream = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Your credit balance is too low (acct 12345)" } }), { status: 402, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", upstream);
});
afterEach(() => {
  setSharedCounter(undefined);
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
  delete process.env.TOGETHER_API_KEY;
});

const glossBody = (over: Record<string, unknown> = {}) => ({ title: "T", action: "explain", anchor: null, context: [{ id: "p1", n: 1, text: "x" }], ...over });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("SlidingWindowLimiter", () => {
  it("allows max hits per window, reports retry-after, and frees up as the window slides", () => {
    const l = new SlidingWindowLimiter();
    expect([0, 1, 2].map((i) => l.hit("k", 3, 1000, 1000 + i).ok)).toEqual([true, true, true]);
    const blocked = l.hit("k", 3, 1000, 1500);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(500); // oldest hit at t=1000 leaves the window at t=2000
    expect(l.hit("other", 3, 1000, 1500).ok).toBe(true); // keys are independent
    expect(l.hit("k", 3, 1000, 2001).ok).toBe(true);
  });
  it("stays bounded in memory", () => {
    const l = new SlidingWindowLimiter(100);
    for (let i = 0; i < 1000; i++) l.hit(`k${i}`, 5, 60_000, 1000 + i);
    expect((l as unknown as { hits: Map<string, number[]> }).hits.size).toBeLessThanOrEqual(100);
  });
  it("is configured from the environment and can be switched off", () => {
    expect(limitFor("gloss")).toEqual({ max: 30, windowMs: 3_600_000 });
    process.env.GLOSS_RATE_GLOSS = "5";
    process.env.GLOSS_RATE_WINDOW_SEC = "60";
    expect(limitFor("gloss")).toEqual({ max: 5, windowMs: 60_000 });
    process.env.GLOSS_RATE_GLOSS = "off";
    expect(limitFor("gloss")).toBeNull();
    process.env.GLOSS_RATE_GLOSS = "garbage";
    expect(limitFor("gloss")?.max).toBe(30);
  });
});

describe("limitHistory", () => {
  it("keeps the newest turns within the turn and character budget and starts on a user turn", () => {
    const turns = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content: `turn ${i}` }));
    const kept = limitHistory(turns);
    expect(kept.length).toBeLessThanOrEqual(LIMITS.historyTurns);
    expect(kept[0].role).toBe("user");
    expect(kept[kept.length - 1].content).toBe("turn 29");
    const big = [{ role: "user" as const, content: "a".repeat(5000) }, { role: "assistant" as const, content: "b".repeat(5000) }, { role: "user" as const, content: "c".repeat(5000) }, { role: "assistant" as const, content: "d".repeat(5000) }, { role: "user" as const, content: "e".repeat(5000) }];
    const total = limitHistory(big).reduce((n, t) => n + t.content.length, 0);
    expect(total).toBeLessThanOrEqual(LIMITS.historyChars);
    expect(limitHistory(undefined)).toEqual([]);
  });
});

describe("/api/gloss on the server key", () => {
  it("answers 429 with Retry-After once the per-client budget is spent, before any validation or upstream call", async () => {
    process.env.GLOSS_RATE_GLOSS = "3";
    const { POST } = await import("@/app/api/gloss/route");
    const same = { "x-forwarded-for": "203.0.113.7" };
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await POST(post("/api/gloss", "{not json", same))).status);
    expect(codes).toEqual([400, 400, 400, 429, 429]);
    const res = await POST(post("/api/gloss", "{not json", same));
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).message).toMatch(/own Together key/);
    expect((await POST(post("/api/gloss", "{not json", { "x-forwarded-for": "203.0.113.8" }))).status).toBe(400); // another client is unaffected
    expect(upstream).not.toHaveBeenCalled();
  });

  it("meters a reader across addresses by its signed cookie, and ignores a forged cookie", async () => {
    process.env.GLOSS_RATE_GLOSS = "2";
    const { POST } = await import("@/app/api/gloss/route");
    const cookie = `${READER_COOKIE}=${readerCookieValue("r_sectest")}`;
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await POST(post("/api/gloss", "{", { cookie }))).status); // a different address each time
    expect(statuses).toEqual([400, 400, 429]);
    const forged: number[] = [];
    for (let i = 0; i < 4; i++) forged.push((await POST(post("/api/gloss", "{", { cookie: `${READER_COOKIE}=r_sectest.AAAAAAAAAAAAAAAAAAAAAA` }))).status);
    expect(forged).toEqual([400, 400, 400, 400]); // a cookie that does not verify is not a reader
  });

  it("never meters a reader's own key", async () => {
    process.env.GLOSS_RATE_GLOSS = "1";
    const { POST } = await import("@/app/api/gloss/route");
    const h = { "x-gloss-key": "tgp_user", "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < 4; i++) expect((await POST(post("/api/gloss", "{", h))).status).toBe(400);
  });

  it("rejects oversized quote, prefix, block ids, unknown actions and oversized bodies (400/413) without calling the provider", async () => {
    const { POST } = await import("@/app/api/gloss/route");
    const anchor = (over: Record<string, unknown>) => ({ start: { b: "p1", o: 0 }, end: { b: "p1", o: 5 }, quote: "hello", ...over });
    for (const body of [
      glossBody({ anchor: anchor({ quote: "q".repeat(LIMITS.quote + 1) }) }),
      glossBody({ anchor: anchor({ prefix: "p".repeat(LIMITS.anchorContext + 1) }) }),
      glossBody({ anchor: anchor({ suffix: "s".repeat(LIMITS.anchorContext + 1) }) }),
      glossBody({ anchor: anchor({ start: { b: "b".repeat(LIMITS.blockId + 1), o: 0 } }) }),
      glossBody({ action: "write-me-a-novel" }),
      glossBody({ history: Array.from({ length: 41 }, () => ({ role: "user", content: "x" })) }),
    ]) {
      expect((await POST(post("/api/gloss", body))).status).toBe(400);
    }
    const huge = await POST(post("/api/gloss", { ...glossBody(), pad: "x".repeat(LIMITS.jsonBytes + 10) }));
    expect(huge.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("accepts a normal request and trims a long history instead of forwarding it all", async () => {
    const { POST } = await import("@/app/api/gloss/route");
    const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "z".repeat(5000) }));
    await (await POST(post("/api/gloss", glossBody({ history, anchor: { start: { b: "p1", o: 0 }, end: { b: "p1", o: 1 }, quote: "x" } })))).text();
    expect(upstream).toHaveBeenCalled();
    const sent = JSON.parse(String((upstream.mock.calls[0][1] as RequestInit).body)) as { messages: { role: string; content: string }[] };
    const chars = sent.messages.reduce((n, m) => n + m.content.length, 0);
    expect(sent.messages.length).toBeLessThanOrEqual(LIMITS.historyTurns + 2); // history + system + final user turn
    expect(chars).toBeLessThan(LIMITS.historyChars + 3000);
  });

  it("returns a fixed message, not provider text, on the server key (SEC-11); the reader's own key still sees the real reason", async () => {
    const { POST } = await import("@/app/api/gloss/route");
    const server = await (await POST(post("/api/gloss", glossBody()))).text();
    expect(server).toContain(SERVER_KEY_ERROR);
    expect(server).not.toMatch(/credit|12345/);
    const own = await (await POST(post("/api/gloss", glossBody(), { "x-gloss-key": "tgp_user" }))).text();
    expect(own).toMatch(/credit balance/);
  });
});

describe("/api/search on the server key", () => {
  it("is metered, bounded and keeps provider text out of the response", async () => {
    process.env.GLOSS_RATE_SEARCH = "2";
    const { POST } = await import("@/app/api/search/route");
    const same = { "x-forwarded-for": "203.0.113.20" };
    const ok = { q: "chalk", passages: [{ key: "0", text: "chalk" }] };
    const first = await POST(post("/api/search", ok, same));
    expect(first.status).toBe(502);
    expect(JSON.stringify(await first.json())).not.toMatch(/credit|12345/);
    expect((await POST(post("/api/search", ok, same))).status).toBe(502);
    expect((await POST(post("/api/search", ok, same))).status).toBe(429);
    const many = { q: "chalk", passages: Array.from({ length: 40 }, (_, i) => ({ key: String(i), text: "t".repeat(1500) })) }; // 60,000 chars in total
    expect((await POST(post("/api/search", many))).status).toBe(400);
    expect((await POST(post("/api/search", { q: "x", passages: [{ key: "k".repeat(100), text: "x" }] }))).status).toBe(400);
  });
});

/**
 * Same request, but the multipart body is serialised first and handed over as a stream the test controls (no Content-Length).
 * A `FormData` body is produced by an internal generator that, on Node 24.21 and later, still enqueues after the reader has
 * cancelled it and raises an unhandled "ReadableStream is already closed" long after the test; a pull-based stream simply
 * stops being pulled. The route's behaviour (counting bytes and cancelling at the limit) is what is under test.
 */
async function streamedAudioRequest(blob: Blob, headers: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("audio", blob, "speech.webm");
  fd.append("language", "en");
  const probe = new Response(fd);
  const type = probe.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await probe.arrayBuffer());
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + 65_536));
      offset += 65_536;
    },
  });
  return new Request("http://localhost/api/speech/transcribe", { method: "POST", headers: { "x-forwarded-for": ip(), "content-type": type, ...headers }, body, duplex: "half" } as RequestInit);
}

function audioRequest(blob: Blob, headers: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("audio", blob, "speech.webm");
  fd.append("language", "en");
  return new Request("http://localhost/api/speech/transcribe", { method: "POST", headers: { "x-forwarded-for": ip(), ...headers }, body: fd });
}

describe("/api/speech/transcribe", () => {
  it("refuses an oversized recording without forwarding it (streamed body, no Content-Length)", async () => {
    const { POST } = await import("@/app/api/speech/transcribe/route");
    const res = await POST(await streamedAudioRequest(new Blob([new Uint8Array(LIMITS.audioBytes + 200_000)], { type: "audio/webm" })));
    expect(res.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("refuses an oversized recording by its declared Content-Length before reading it", async () => {
    const { POST } = await import("@/app/api/speech/transcribe/route");
    const req = audioRequest(new Blob([new Uint8Array(10)], { type: "audio/webm" }), { "content-length": String(LIMITS.audioBytes * 4) });
    expect((await POST(req)).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("only accepts audio types", async () => {
    const { POST } = await import("@/app/api/speech/transcribe/route");
    expect((await POST(audioRequest(new Blob(["<html>"], { type: "text/html" })))).status).toBe(415);
    expect((await POST(audioRequest(new Blob(["x"], { type: "" })))).status).toBe(415);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("forwards a webm/opus recording with a timeout signal, and hides provider text on the server key", async () => {
    const { POST } = await import("@/app/api/speech/transcribe/route");
    const res = await POST(audioRequest(new Blob([new Uint8Array(2000)], { type: "audio/webm;codecs=opus" })));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).toContain(SERVER_KEY_ERROR);
    const init = upstream.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const own = await POST(audioRequest(new Blob([new Uint8Array(2000)], { type: "audio/webm" }), { "x-gloss-key": "tgp_user" }));
    expect((await own.json()).message).toMatch(/Transcription failed \(402\)/);
  });
  it("is metered on the server key only", async () => {
    process.env.GLOSS_RATE_TRANSCRIBE = "1";
    const { POST } = await import("@/app/api/speech/transcribe/route");
    const h = { "x-forwarded-for": "203.0.113.30" };
    const blob = () => new Blob([new Uint8Array(100)], { type: "audio/webm" });
    expect((await POST(audioRequest(blob(), h))).status).toBe(502);
    expect((await POST(audioRequest(blob(), h))).status).toBe(429);
    expect((await POST(audioRequest(blob(), { ...h, "x-gloss-key": "tgp_user" }))).status).toBe(502);
  });
});
