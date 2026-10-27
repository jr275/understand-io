import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryAiStore, setAiStore } from "@/lib/server/aiStore";

/** The /api/ai route with the AI SDK's generateText replaced: everything else (key resolution, limits, validation, evidence checks) is real. */
const generateText = vi.fn();
vi.mock("ai", () => ({ generateText: (...a: unknown[]) => generateText(...a), streamText: vi.fn() }));

const BLOCKS = [
  { id: "p1", n: 1, type: "p", text: "The tide rises when the moon passes overhead and falls afterwards." },
  { id: "p2", n: 2, type: "p", text: "Spring tides are higher because the sun and the moon pull together." },
];
const body = (over: Record<string, unknown> = {}) => ({ op: "summarize", variant: "quick", title: "Tides", blocks: BLOCKS, totalParagraphs: 2, ...over });
const post = (b: unknown, headers: Record<string, string> = { "x-gloss-key": "user-key-for-test" }, raw?: string) =>
  new Request("http://x.test/api/ai", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ?? JSON.stringify(b) });

let POST: (req: Request) => Promise<Response>;
beforeEach(async () => {
  setAiStore(createMemoryAiStore()); // allowances in memory: no database involved
  delete process.env.TOGETHER_API_KEY;
  generateText.mockReset();
  ({ POST } = await import("@/app/api/ai/route"));
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/ai", () => {
  it("answers 402 needs-key when there is no key at all, without calling the provider", async () => {
    const res = await POST(post(body(), {}));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("needs-key");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("rejects malformed and out-of-bounds requests before the provider is called", async () => {
    const bad = [body({ op: "delete-everything" }), body({ blocks: "x" }), body({ targetLang: "xx" }), body({ totalParagraphs: -1 }), body({ blocks: Array.from({ length: 701 }, (_, i) => ({ id: `p${i}`, text: "x" })) }), body({ blocks: [{ id: "p1", text: "x".repeat(7000) }] })];
    for (const b of bad) expect((await POST(post(b))).status).toBe(400);
    expect((await POST(post(null, undefined, "{not json"))).status).toBe(400);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("returns a checked result with model, usage and coverage", async () => {
    generateText.mockResolvedValue({
      text: JSON.stringify({ items: [{ text: "Tides follow the moon.", basis: "text", evidence: [{ id: "p1", quote: "tide rises when the moon passes overhead" }, { id: "p2", quote: "a quote that is not in the text at all" }] }] }),
      usage: { inputTokens: 120, outputTokens: 60 },
    });
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.result.kind).toBe("summary");
    expect(j.result.items[0].basis).toBe("text");
    expect(j.result.items[0].evidence).toHaveLength(1); // the invented quote was dropped
    expect(j.result.coverage).toMatchObject({ used: 2, total: 2, complete: true });
    expect(j.usage).toMatchObject({ input: 120, output: 60 });
    expect(typeof j.model).toBe("string");
    expect(generateText.mock.calls[0][0]).toMatchObject({ temperature: 0.2 });
  });

  it("a reply that is not usable becomes a 502 with a plain message, after one retry", async () => {
    generateText.mockResolvedValue({ text: "I cannot do that.", usage: { inputTokens: 1, outputTokens: 1 } });
    const res = await POST(post(body()));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("bad-output");
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("missing selection for a passage summary is a 400, not a made-up answer", async () => {
    const res = await POST(post(body({ variant: "passage" })));
    expect(res.status).toBe(400);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("translation returns the reader's own text as the original", async () => {
    generateText.mockResolvedValue({ text: JSON.stringify({ sourceLang: "en", natural: "A maré sobe." }), usage: { inputTokens: 5, outputTokens: 5 } });
    const res = await POST(post(body({ op: "translate", selection: "The tide rises.", targetLang: "pt" })));
    const j = await res.json();
    expect(j.result).toMatchObject({ kind: "translation", original: "The tide rises.", natural: "A maré sobe.", targetLang: "pt" });
  });

  it("a provider failure with a user key says what happened; the log has the status only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateText.mockRejectedValue(Object.assign(new Error("401 Unauthorized: invalid api key for tgp_secret_value"), { statusCode: 401 }));
    const res = await POST(post(body()));
    expect(res.status).toBe(502);
    const j = await res.json();
    expect(j.message).toBe("That key was not accepted by Together AI.");
    expect(JSON.stringify(j)).not.toContain("tgp_secret_value");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("tgp_secret_value");
  });

  it("with the shared server key, provider text never reaches the caller", async () => {
    process.env.TOGETHER_API_KEY = "server-key-for-test";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    generateText.mockRejectedValue(new Error("account 42 has insufficient credit: server-key-for-test"));
    const res = await POST(post(body(), {}));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("account 42");
    expect(text).not.toContain("server-key-for-test");
  });
});
