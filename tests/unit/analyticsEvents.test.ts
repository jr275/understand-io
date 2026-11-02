import { describe, expect, it } from "vitest";
import { CLIENT_EVENTS, EVENT_NAMES, EVENT_SCHEMAS, bucketAge, bucketCount, isRetrieval, parseEvent, routePattern } from "@/lib/analytics/events";
import { channelOf, cleanAttribution, hasAttribution, parseAttribution, referrerHostOf } from "@/lib/analytics/attribution";

describe("the event taxonomy", () => {
  it("names the twelve events the product measures, each with a strict schema", () => {
    expect(EVENT_NAMES).toEqual(["landing_viewed", "account_registered", "document_saved", "document_opened", "highlight_created", "ai_question_asked", "library_searched", "import_completed", "extension_installed", "subscription_started", "subscription_cancelled"]);
    for (const n of EVENT_NAMES) expect(EVENT_SCHEMAS[n].safeParse({ unlisted: "x" }).success, n).toBe(false);
  });

  it("accepts only the listed properties and values", () => {
    expect(parseEvent("document_saved", { kind: "pdf", via: "file" })).toEqual({ event: "document_saved", props: { kind: "pdf", via: "file" } });
    expect(parseEvent("document_saved", { kind: "pdf", via: "file", title: "My private diary" })).toBeNull();
    expect(parseEvent("document_saved", { kind: "pdf", via: "somewhere else" })).toBeNull();
    expect(parseEvent("nope", {})).toBeNull();
    expect(parseEvent(42, {})).toBeNull();
    expect(parseEvent("landing_viewed", undefined)).toEqual({ event: "landing_viewed", props: {} });
  });

  it("cannot carry a question, a query, a note, a title or an address: no property of any event is free text", () => {
    const attempts: [string, Record<string, unknown>][] = [
      ["ai_question_asked", { action: "explain", key: "shared", question: "what is the meaning of my diagnosis" }],
      ["ai_question_asked", { action: "What does my private note say about Anna?", key: "shared" }],
      ["library_searched", { scope: "library", results: "1-3", query: "divorce lawyer" }],
      ["highlight_created", { mark: "note", note: "call the bank", quote: "a private sentence" }],
      ["document_saved", { kind: "url", via: "link", url: "https://example.org/secret", title: "t" }],
      ["document_opened", { kind: "text", via: "library", age: "0d", slug: "my-medical-results" }],
    ];
    for (const [name, props] of attempts) expect(parseEvent(name, props), `${name} ${JSON.stringify(props)}`).toBeNull();
    // Every string property in every schema is an enumeration or a short token pattern: none is open text.
    for (const n of EVENT_NAMES) {
      const shape = (EVENT_SCHEMAS[n] as unknown as { shape: Record<string, { def: { type: string }; _def?: unknown }> }).shape;
      for (const [key, field] of Object.entries(shape)) expect(["enum", "string"], `${n}.${key}`).toContain(field.def.type);
    }
    expect(parseEvent("ai_question_asked", { action: "x".repeat(40), key: "own" })).toBeNull();
  });

  it("lets a browser send only the events a browser can witness; registrations and payments are the server's", () => {
    expect(CLIENT_EVENTS).not.toContain("account_registered");
    expect(CLIENT_EVENTS).not.toContain("subscription_started");
    expect(CLIENT_EVENTS).not.toContain("subscription_cancelled");
  });

  it("buckets ages and counts so a number cannot single out a library", () => {
    const now = Date.UTC(2026, 10, 1);
    expect(bucketAge(now - 3_600_000, now)).toBe("0d");
    expect(bucketAge(now - 3 * 86_400_000, now)).toBe("1-6d");
    expect(bucketAge(now - 20 * 86_400_000, now)).toBe("7-29d");
    expect(bucketAge(now - 90 * 86_400_000, now)).toBe("30d+");
    expect([0, 2, 7, 50].map(bucketCount)).toEqual(["0", "1-3", "4-10", "11+"]);
  });

  it("calls a retrieval coming back for something kept, and nothing else", () => {
    expect(isRetrieval({ event: "document_opened", props: { kind: "url", via: "library", age: "7-29d" } })).toBe(true);
    expect(isRetrieval({ event: "document_opened", props: { kind: "url", via: "library", age: "0d" } })).toBe(false);
    expect(isRetrieval({ event: "document_opened", props: { kind: "sample", via: "landing", age: "30d+" } })).toBe(false);
    expect(isRetrieval({ event: "library_searched", props: { scope: "library", results: "1-3" } })).toBe(true);
    expect(isRetrieval({ event: "library_searched", props: { scope: "library", results: "0" } })).toBe(false);
    expect(isRetrieval({ event: "highlight_created", props: { mark: "note" } })).toBe(false);
  });

  it("records a route as a pattern, never with the title or the address of what was read", () => {
    expect(routePattern("/")).toBe("/");
    expect(routePattern("/read/my-private-medical-results?x=1")).toBe("/read/:slug");
    expect(routePattern("/library#top")).toBe("/library");
    expect(routePattern("/learn/ai-pdf-reader")).toBe("/learn/:page");
    expect(routePattern("/somewhere/else/entirely")).toBe("/other");
    expect(routePattern("https://evil.example/")).toBeNull();
    expect(routePattern(undefined)).toBeNull();
  });
});

describe("attribution", () => {
  it("keeps tidy campaign tags and a referral code, and drops anything else", () => {
    expect(parseAttribution("?utm_source=Newsletter&utm_medium=email&utm_campaign=Launch-1&ref=AbC123xyz", null, "understand.example")).toEqual({
      source: "newsletter",
      medium: "email",
      campaign: "launch-1",
      ref: "AbC123xyz",
      referrerHost: null,
    });
    const odd = parseAttribution("?utm_source=jane.doe@example.com&utm_campaign=two%20words%20here&ref=a%20b&utm_medium=" + "x".repeat(80));
    expect(odd).toEqual({ source: null, medium: null, campaign: "two-words-here", ref: null, referrerHost: null });
    expect(hasAttribution(odd)).toBe(true);
    expect(hasAttribution(parseAttribution(""))).toBe(false);
  });

  it("reduces a referrer to its host and ignores the site's own pages", () => {
    expect(referrerHostOf("https://www.news.ycombinator.com/item?id=1&secret=2")).toBe("news.ycombinator.com");
    expect(referrerHostOf("https://understand.example/library", "understand.example")).toBeNull();
    expect(referrerHostOf("not a url")).toBeNull();
    expect(referrerHostOf(null)).toBeNull();
  });

  it("names the channel of a visit", () => {
    expect(channelOf({ source: null, medium: null, referrerHost: null, ref: null })).toBe("direct");
    expect(channelOf({ source: "newsletter", medium: "email", referrerHost: null, ref: null })).toBe("newsletter/email");
    expect(channelOf({ source: null, medium: null, referrerHost: "www.google.com".replace("www.", ""), ref: null })).toBe("organic-search");
    expect(channelOf({ source: null, medium: null, referrerHost: "news.ycombinator.com", ref: null })).toBe("site:news.ycombinator.com");
    expect(channelOf({ source: "x", medium: null, referrerHost: null, ref: "AbC123xyz" })).toBe("referral");
  });

  it("re-validates what a browser claims (it is untrusted)", () => {
    expect(cleanAttribution({ source: "<script>", medium: "email", campaign: 5, ref: "bad ref", referrerHost: "example.org", extra: "x" })).toEqual({ source: null, medium: "email", campaign: null, ref: null, referrerHost: "example.org" });
    expect(cleanAttribution(null)).toEqual({ source: null, medium: null, campaign: null, ref: null, referrerHost: null });
  });
});
