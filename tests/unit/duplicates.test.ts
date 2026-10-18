import { describe, expect, it } from "vitest";
import { fingerprint, findDuplicate, normalizeSourceUrl } from "@/lib/store/duplicates";
import type { GlossDocument } from "@/lib/content/types";

const long = "The cliffs are made of chalk, a soft white limestone laid down over millions of years from the shells of tiny sea creatures. ".repeat(3);
const doc = (slug: string, over: Partial<GlossDocument> = {}): GlossDocument => ({ id: `local:${slug}`, slug, kind: "url", title: slug, topic: "writing", minutes: 1, paragraphs: 1, blocks: [{ id: "p1", type: "p", text: long }], ...over });

describe("normalizeSourceUrl", () => {
  it("treats the same page written differently as one address", () => {
    const a = normalizeSourceUrl("https://www.Example.com/Post/?utm_source=x&b=2&a=1#section");
    expect(a).toBe("example.com/Post?a=1&b=2");
    expect(normalizeSourceUrl("example.com/Post?b=2&a=1&fbclid=zzz")).toBe(a);
    expect(normalizeSourceUrl("http://example.com/Post/?a=1&b=2")).toBe(a);
  });
  it("keeps what makes pages different", () => {
    expect(normalizeSourceUrl("https://example.com/a")).not.toBe(normalizeSourceUrl("https://example.com/b"));
    expect(normalizeSourceUrl("https://example.com/p?id=1")).not.toBe(normalizeSourceUrl("https://example.com/p?id=2"));
    expect(normalizeSourceUrl("https://example.com:8080/a")).not.toBe(normalizeSourceUrl("https://example.com/a"));
  });
  it("is null for anything that is not a web address", () => {
    expect(normalizeSourceUrl("ftp://example.com/a")).toBeNull();
    expect(normalizeSourceUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("findDuplicate", () => {
  it("finds a text saved from the same address, however the address was written", () => {
    const saved = doc("a", { sourceUrl: "https://example.com/post?utm_campaign=y" });
    expect(findDuplicate([saved], { url: "www.example.com/post/" })).toBe(saved);
    expect(findDuplicate([saved], { url: "https://example.com/other" })).toBeNull();
  });
  it("does not call a saved link a duplicate, so the reader can try the address again", () => {
    expect(findDuplicate([doc("a", { kind: "link", sourceUrl: "https://example.com/post" })], { url: "https://example.com/post" })).toBeNull();
  });
  it("never matches a sample", () => {
    expect(findDuplicate([doc("a", { kind: "sample", sourceUrl: "https://example.com/post" })], { url: "https://example.com/post" })).toBeNull();
  });
  it("finds the same words pasted with other spacing and case, but not a short text or a different one", () => {
    const saved = doc("a", { kind: "text", sourceUrl: null });
    expect(findDuplicate([saved], { text: `  ${long.toUpperCase().replace(/ /g, "\n ")}  ` })).toBe(saved);
    expect(findDuplicate([saved], { text: `${long} One more sentence at the end.` })).toBeNull();
    expect(findDuplicate([doc("s", { blocks: [{ id: "p1", type: "p", text: "Short." }] })], { text: "Short." })).toBeNull();
  });
  it("compares by fingerprint, which differs for different texts", () => {
    expect(fingerprint("a b c")).toBe(fingerprint("A  B\nC"));
    expect(fingerprint("a b c")).not.toBe(fingerprint("a b d"));
  });
});
