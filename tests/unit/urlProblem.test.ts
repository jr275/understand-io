import { describe, expect, it } from "vitest";
import { looksLikeUrl, normaliseUrl, urlProblem } from "@/lib/client/import";

describe("urlProblem: what is said about an address before anything is sent", () => {
  it("says nothing about an empty field or a usable address", () => {
    for (const ok of ["", "   ", "https://example.com/a", "http://127.0.0.1/x", "example.com", "www.example.co.uk/path?q=1", "EXAMPLE.com/Page"]) expect(urlProblem(ok), ok).toBeNull();
  });

  it("names another protocol as such", () => {
    for (const s of ["mailto:someone@example.com", "ftp://example.com/file", "javascript:alert(1)", "file:///etc/passwd", "tel:+15551234"]) expect(urlProblem(s), s).toBe("scheme");
  });

  it("calls text that is not an address invalid", () => {
    for (const s of ["not a link at all", "hello", "foo.", "a b.com"]) expect(urlProblem(s), s).toBe("invalid");
  });

  it("agrees with looksLikeUrl about what can be sent, and normaliseUrl gives it a scheme", () => {
    for (const s of ["example.com/a", "https://example.com", "nope", "mailto:a@b.co"]) expect(looksLikeUrl(s) === (urlProblem(s) === null), s).toBe(true);
    expect(normaliseUrl("  example.com/a ")).toBe("https://example.com/a");
    expect(normaliseUrl("http://example.com/a")).toBe("http://example.com/a");
  });
});
